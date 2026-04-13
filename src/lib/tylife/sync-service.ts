/**
 * TY Life 동기화 서비스.
 * 서버 전용. 브라우저에서 호출 금지.
 *
 * 흐름:
 * 1. sync_runs 레코드 생성 (running)
 * 2. 리스트 페이지 순회 → parseContractListHtml → ParsedListItem[]
 * 3. 각 항목:
 *    a. 리스트 데이터로 customer / member / contract upsert (부분)
 *    b. 상세 HTML fetch → parseContractDetailHtml
 *    c. 상세 데이터로 contract 보강 upsert
 * 4. sync_runs 완료 처리
 */

import { createAdminSupabaseClient } from '../supabase/server';
import { fetchContractList, fetchContractDetailHtml } from './client';
import { parseContractListHtml, parseContractDetailHtml } from './html-parser';
import {
  normalizeCustomerFromList,
  normalizeContractFromList,
  mergeDetailIntoContract,
  normalizeSalesMember,
} from './normalize';
import type { SyncResult, SyncOptions, SyncRun, ParsedListItem } from '../types/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractInsert } from '../types/contract';

// ─────────────────────────────────────────────
// 로그 헬퍼
// ─────────────────────────────────────────────

async function log(
  db: SupabaseClient,
  runId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  await db.from('sync_logs').insert({
    run_id: runId,
    level,
    message,
    context: context ?? null,
  });
}

// ─────────────────────────────────────────────
// Upsert 헬퍼
// ─────────────────────────────────────────────

async function upsertSalesMember(
  db: SupabaseClient,
  memberData: ReturnType<typeof normalizeSalesMember>,
): Promise<string | null> {
  // external_id 없으면 이름으로 조회 후 없으면 insert
  if (!memberData.external_id) {
    const { data: existing } = await db
      .from('organization_members')
      .select('id')
      .eq('name', memberData.name)
      .limit(1)
      .single();

    if (existing) return (existing as { id: string }).id;

    const { data, error } = await db
      .from('organization_members')
      .insert(memberData)
      .select('id')
      .single();

    if (error) throw new Error(`organization_members insert 실패: ${error.message}`);
    return (data as { id: string }).id;
  }

  const { data, error } = await db
    .from('organization_members')
    .upsert(memberData, { onConflict: 'external_id' })
    .select('id')
    .single();

  if (error) throw new Error(`organization_members upsert 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function upsertCustomer(
  db: SupabaseClient,
  customerData: ReturnType<typeof normalizeCustomerFromList>,
): Promise<string> {
  if (!customerData) throw new Error('customerData가 null입니다');

  const { data, error } = await db
    .from('customers')
    .upsert(customerData, { onConflict: 'ssn_masked' })
    .select('id')
    .single();

  if (error) throw new Error(`customers upsert 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function upsertContract(
  db: SupabaseClient,
  contractData: ContractInsert,
): Promise<{ id: string; isNew: boolean }> {
  const { data: existing } = await db
    .from('contracts')
    .select('id, status')
    .eq('contract_code', contractData.contract_code)
    .maybeSingle();

  const { data, error } = await db
    .from('contracts')
    .upsert(contractData, { onConflict: 'contract_code' })
    .select('id')
    .single();

  if (error) throw new Error(`contracts upsert 실패: ${error.message}`);

  const contractId = (data as { id: string }).id;
  const isNew = !existing;
  const existingStatus = existing ? (existing as { status: string }).status : null;

  // 상태 변경 이력 기록
  if (existingStatus && existingStatus !== contractData.status) {
    await db.from('contract_status_histories').insert({
      contract_id: contractId,
      from_status: existingStatus,
      to_status: contractData.status,
      changed_by: 'sync-service',
    });
  }

  return { id: contractId, isNew };
}

// ─────────────────────────────────────────────
// 단일 계약 처리
// ─────────────────────────────────────────────

async function processSingleContract(
  db: SupabaseClient,
  runId: string,
  item: ParsedListItem,
  dryRun: boolean,
): Promise<'created' | 'updated' | 'error'> {
  try {
    // ── Phase 1: 리스트 데이터로 기본 upsert ──

    const customerData = normalizeCustomerFromList(item);
    if (!customerData) {
      throw new Error(`고객 SSN 마스킹 파싱 실패 (ssn_masked: "${item.ssn_masked}")`);
    }

    const memberData = normalizeSalesMember({
      sales_member_name: item.sales_member_name ?? '',
      sales_member_external_id: null, // Phase 2 에서 보강
      org_rank: item.affiliation_name,
    });

    if (dryRun) {
      await log(db, runId, 'info', `[dry-run] 파싱 성공: ${item.contract_code}`, {
        customer_name: item.customer_name,
        external_id: item.external_id,
      });
      return 'updated';
    }

    const customerId = await upsertCustomer(db, customerData);
    const salesMemberId = item.sales_member_name
      ? await upsertSalesMember(db, memberData)
      : null;

    const contractBase = normalizeContractFromList(item, customerId, salesMemberId);

    // ── Phase 2: 상세 HTML fetch → 보강 ──

    let contractFinal: ContractInsert = contractBase;

    if (item.external_id) {
      try {
        const html = await fetchContractDetailHtml(item.external_id);
        const detail = parseContractDetailHtml(html, item.contract_code);

        contractFinal = mergeDetailIntoContract(contractBase, detail);

        // 사원 external_id 확보 → member upsert 재시도
        if (detail.sales_member_external_id && salesMemberId) {
          await db
            .from('organization_members')
            .update({ external_id: detail.sales_member_external_id })
            .eq('id', salesMemberId);
        }
      } catch (detailErr) {
        const msg = detailErr instanceof Error ? detailErr.message : String(detailErr);
        await log(db, runId, 'warn', `상세 fetch 실패 (리스트 데이터로 저장): ${item.contract_code}`, {
          external_id: item.external_id,
          error: msg,
        });
        // 상세 실패 시 리스트 데이터로만 저장 (계속 진행)
      }
    }

    const { isNew } = await upsertContract(db, contractFinal);

    await log(db, runId, 'info', `계약 ${isNew ? '생성' : '갱신'}: ${item.contract_code}`);
    return isNew ? 'created' : 'updated';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, runId, 'error', `계약 처리 실패: ${item.contract_code}`, {
      external_id: item.external_id,
      error: message,
    });
    return 'error';
  }
}

// ─────────────────────────────────────────────
// 페이지 순회 헬퍼
// ─────────────────────────────────────────────

async function fetchAllPages(
  rowPerPage: number,
  maxPage: number | undefined,
  onPage: (page: number, count: number) => void,
): Promise<ParsedListItem[]> {
  const all: ParsedListItem[] = [];
  let page = 1;

  while (true) {
    if (maxPage && page > maxPage) break;

    const res = await fetchContractList(page, rowPerPage);
    const listHtml = res.data?.listHtml ?? '';
    const items = parseContractListHtml(listHtml);

    if (items.length === 0) break;

    all.push(...items);
    onPage(page, all.length);

    // 마지막 페이지 판정: rowPerPage 보다 적으면 종료
    if (items.length < rowPerPage) break;

    page++;
  }

  return all;
}

// ─────────────────────────────────────────────
// 메인 sync 실행
// ─────────────────────────────────────────────

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const {
    triggeredBy = 'manual',
    rowPerPage = 50,
    maxPage,
    dryRun = false,
  } = options;

  const db = createAdminSupabaseClient();
  const startedAt = Date.now();

  const { data: runData, error: runError } = await db
    .from('sync_runs')
    .insert({ status: 'running', triggered_by: triggeredBy })
    .select('id')
    .single();

  if (runError || !runData) {
    throw new Error(`sync_runs 생성 실패: ${runError?.message}`);
  }

  const runId = (runData as SyncRun).id;
  let totalFetched = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  try {
    await log(db, runId, 'info', `동기화 시작${dryRun ? ' [dry-run]' : ''}`, {
      row_per_page: rowPerPage,
      max_page: maxPage ?? 'unlimited',
    });

    const allItems = await fetchAllPages(rowPerPage, maxPage, (page, count) => {
      console.log(`[sync] 페이지 ${page} 수집 — 누적 ${count}건`);
    });

    totalFetched = allItems.length;
    await log(db, runId, 'info', `총 ${totalFetched}건 목록 수집 완료`);

    for (const item of allItems) {
      const result = await processSingleContract(db, runId, item, dryRun);

      if (result === 'created') totalCreated++;
      else if (result === 'updated') totalUpdated++;
      else if (result === 'error') totalErrors++;
    }

    await db
      .from('sync_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_fetched: totalFetched,
        total_created: totalCreated,
        total_updated: totalUpdated,
        total_errors: totalErrors,
      })
      .eq('id', runId);

    await log(db, runId, 'info', '동기화 완료', {
      total_fetched: totalFetched,
      total_created: totalCreated,
      total_updated: totalUpdated,
      total_errors: totalErrors,
      dry_run: dryRun,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await db
      .from('sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        total_fetched: totalFetched,
        total_created: totalCreated,
        total_updated: totalUpdated,
        total_errors: totalErrors + 1,
      })
      .eq('id', runId);

    await log(db, runId, 'error', `동기화 실패: ${message}`);
    throw err;
  }

  return {
    run_id: runId,
    status: 'completed',
    total_fetched: totalFetched,
    total_created: totalCreated,
    total_updated: totalUpdated,
    total_errors: totalErrors,
    duration_ms: Date.now() - startedAt,
  };
}
