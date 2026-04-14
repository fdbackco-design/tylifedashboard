/**
 * TY Life 동기화 서비스.
 * 서버 전용. 브라우저에서 호출 금지.
 *
 * 주요 함수:
 *   syncContractPage(page, opts) — 단일 페이지 동기화
 *   runSync(opts)                — 전체 동기화 (syncContractPage 반복)
 *
 * 흐름 (페이지당):
 *   1. fetchContractList(page) → data.listHtml
 *   2. parseContractListHtml(listHtml) → ParsedListItem[]
 *   3. 각 항목:
 *      a. customer upsert (ssn_masked 기준)
 *      b. organization_member upsert (external_id 기준 or 이름 조회)
 *      c. contract upsert (contract_code 기준) — source_snapshot_json 포함
 *      d. 상세 HTML fetch → unit_count / item_name 보강 (실패 시 계속)
 */

import { createAdminSupabaseClient } from '../supabase/server';
import { fetchContractList, fetchContractDetailHtml } from './client';
import { parseContractListHtml, parseContractDetailHtml } from './html-parser';
import {
  normalizeCustomerFromList,
  normalizeContractFromList,
  mergeDetailIntoContract,
  normalizeSalesMember,
  normalizeStatus,
} from './normalize';
import type {
  SyncResult,
  SyncOptions,
  SyncRun,
  ParsedListItem,
} from '../types/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractInsert } from '../types/contract';

/** 병렬 처리 최대 동시 요청 수 (환경변수로 조정 가능) */
const CONCURRENCY = parseInt(process.env.TYLIFE_CONCURRENCY ?? '5', 10);

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────

/**
 * items를 최대 limit개 동시 실행하며 순서대로 결과를 반환.
 */
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      results[next.i] = await fn(next.item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─────────────────────────────────────────────
// 로그 헬퍼 (에러/경고만 기록 — 건당 성공 로그 제거로 DB write 감소)
// ─────────────────────────────────────────────

async function log(
  db: SupabaseClient,
  runId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  if (level === 'info') return; // info는 DB 기록 생략
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
  if (!memberData.name) return null;

  if (memberData.external_id) {
    const { data, error } = await db
      .from('organization_members')
      .upsert(memberData, { onConflict: 'external_id' })
      .select('id')
      .single();
    if (error) throw new Error(`organization_members upsert 실패: ${error.message}`);
    return (data as { id: string }).id;
  }

  // external_id 없으면 이름으로 조회 후 없으면 insert
  const { data: existing } = await db
    .from('organization_members')
    .select('id')
    .eq('name', memberData.name)
    .limit(1)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db
    .from('organization_members')
    .insert(memberData)
    .select('id')
    .single();
  if (error) throw new Error(`organization_members insert 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function upsertCustomer(
  db: SupabaseClient,
  customerData: NonNullable<ReturnType<typeof normalizeCustomerFromList>>,
): Promise<string> {
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
  const existingStatus = existing ? (existing as { status: string }).status : null;

  // 상태 변경 이력
  if (existingStatus && existingStatus !== contractData.status) {
    await db.from('contract_status_histories').insert({
      contract_id: contractId,
      from_status: existingStatus,
      to_status: contractData.status,
      changed_by: 'sync-service',
    });
  }

  return { id: contractId, isNew: !existing };
}

// ─────────────────────────────────────────────
// 단일 계약 항목 처리
// ─────────────────────────────────────────────

async function processItem(
  db: SupabaseClient,
  runId: string,
  item: ParsedListItem,
  dryRun: boolean,
): Promise<'created' | 'updated' | 'error'> {
  try {
    if (dryRun) {
      await log(db, runId, 'info', `[dry-run] 파싱: ${item.contract_code}`, {
        customer: item.customer_name,
        external_id: item.external_id,
        snapshot_keys: Object.keys(item._snapshot),
      });
      return 'updated';
    }

    // ── 1+2. 고객 · 조직원 upsert 병렬 처리 ──
    const customerData = normalizeCustomerFromList(item);
    if (!customerData) {
      throw new Error(`SSN 파싱 실패 (ssn_masked: "${item.ssn_masked}")`);
    }
    const memberData = normalizeSalesMember({
      sales_member_name: item.sales_member_name ?? '',
      sales_member_external_id: null,
      org_rank: item.affiliation_name,
    });

    const [customerId, salesMemberId] = await Promise.all([
      upsertCustomer(db, customerData),
      item.sales_member_name ? upsertSalesMember(db, memberData) : Promise.resolve(null),
    ]);

    // ── 3. 기존 계약 조회 (상세 fetch 스킵 여부 판단용) ──
    const { data: existingContract } = await db
      .from('contracts')
      .select('id, status, unit_count')
      .eq('contract_code', item.contract_code)
      .maybeSingle();

    const ec = existingContract as { status: string; unit_count: number | null } | null;
    const alreadyHasDetail =
      ec != null &&
      ec.status === normalizeStatus(item.status_raw ?? '') &&
      ec.unit_count != null;

    const contractBase = normalizeContractFromList(item, customerId, salesMemberId);
    let contractFinal: ContractInsert = {
      ...contractBase,
      source_snapshot_json: item._snapshot,
    };

    // ── 4. 상세 HTML fetch (상태 변경 또는 아직 상세 없는 경우만) ──
    if (item.external_id && !alreadyHasDetail) {
      try {
        const html = await fetchContractDetailHtml(item.external_id);
        const detail = parseContractDetailHtml(html, item.contract_code);

        contractFinal = {
          ...mergeDetailIntoContract(contractBase, detail),
          source_snapshot_json: item._snapshot,
        };

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
      }
    }

    const { isNew } = await upsertContract(db, contractFinal);
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
// 단일 페이지 동기화
// ─────────────────────────────────────────────

export interface SyncPageOptions {
  rowPerPage?: number;
  dryRun?: boolean;
}

export interface SyncPageResult {
  page: number;
  fetched: number;
  created: number;
  updated: number;
  errors: number;
  /** 다음 페이지가 있을 가능성 (fetched === rowPerPage) */
  hasMore: boolean;
}

/**
 * 지정 페이지 1개만 동기화.
 * runId가 있으면 해당 sync_run에 로그 기록.
 * 없으면 독립 실행용 임시 runId 생성.
 */
export async function syncContractPage(
  page: number,
  opts: SyncPageOptions = {},
  runId?: string,
): Promise<SyncPageResult> {
  const { rowPerPage = 50, dryRun = false } = opts;
  const db = createAdminSupabaseClient();

  // 독립 실행 시 임시 sync_run 생성
  let ownRunId = runId;
  if (!ownRunId) {
    const { data } = await db
      .from('sync_runs')
      .insert({ status: 'running', triggered_by: `manual-page-${page}` })
      .select('id')
      .single();
    ownRunId = (data as SyncRun).id;
  }

  const apiRes = await fetchContractList(page, rowPerPage);
  const listHtml = apiRes.data?.listHtml ?? '';
  const items = parseContractListHtml(listHtml);

  let created = 0;
  let updated = 0;
  let errors = 0;

  const results = await runConcurrent(items, CONCURRENCY, (item) =>
    processItem(db, ownRunId, item, dryRun),
  );

  for (const result of results) {
    if (result === 'created') created++;
    else if (result === 'updated') updated++;
    else errors++;
  }

  // 독립 실행이면 sync_run 완료 처리
  if (!runId) {
    await db
      .from('sync_runs')
      .update({
        status: errors === items.length && items.length > 0 ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        total_fetched: items.length,
        total_created: created,
        total_updated: updated,
        total_errors: errors,
      })
      .eq('id', ownRunId);
  }

  return {
    page,
    fetched: items.length,
    created,
    updated,
    errors,
    hasMore: items.length >= rowPerPage,
  };
}

// ─────────────────────────────────────────────
// 전체 동기화 (syncContractPage 반복)
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

    let page = 1;

    while (true) {
      if (maxPage && page > maxPage) break;

      console.log(`[sync] 페이지 ${page} 처리 중...`);

      const pageResult = await syncContractPage(
        page,
        { rowPerPage, dryRun },
        runId,
      );

      totalFetched += pageResult.fetched;
      totalCreated += pageResult.created;
      totalUpdated += pageResult.updated;
      totalErrors += pageResult.errors;

      await log(db, runId, 'info', `페이지 ${page} 완료`, {
        fetched: pageResult.fetched,
        created: pageResult.created,
        updated: pageResult.updated,
        errors: pageResult.errors,
      });

      if (!pageResult.hasMore) break;
      page++;
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
