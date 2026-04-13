/**
 * TY Life 동기화 서비스.
 * 서버 전용. 브라우저에서 호출 금지.
 *
 * 흐름:
 * 1. sync_runs 레코드 생성 (running)
 * 2. 전체 계약 목록 페이지 순회
 * 3. 각 계약 상세 HTML 파싱
 * 4. 정규화 → Supabase upsert
 * 5. sync_runs 완료 처리
 */

import { createAdminSupabaseClient } from '../supabase/server';
import { fetchAllContractPages, fetchContractDetailHtml } from './client';
import { parseContractDetailHtml } from './html-parser';
import { normalizeCustomer, normalizeContract, normalizeSalesMember } from './normalize';
import type { SyncResult, SyncRun } from '../types/sync';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  if (!memberData.external_id) return null;

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
  customerData: ReturnType<typeof normalizeCustomer>,
): Promise<string> {
  // ssn_masked를 upsert 기준으로 사용 (동일 고객 중복 방지)
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
  contractData: ReturnType<typeof normalizeContract>,
  previousStatus?: string,
): Promise<{ id: string; isNew: boolean }> {
  // 기존 계약 조회 (상태 변경 이력 기록용)
  const { data: existing } = await db
    .from('contracts')
    .select('id, status')
    .eq('contract_code', contractData.contract_code)
    .single();

  const { data, error } = await db
    .from('contracts')
    .upsert(contractData, { onConflict: 'contract_code' })
    .select('id')
    .single();

  if (error) throw new Error(`contracts upsert 실패: ${error.message}`);

  const contractId = (data as { id: string }).id;
  const isNew = !existing;

  // 상태 변경 이력 기록
  const existingStatus = existing ? (existing as { status: string }).status : null;
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
  externalId: string,
  contractCode: string,
): Promise<'created' | 'updated' | 'error'> {
  try {
    // 1. 상세 HTML 수집
    const html = await fetchContractDetailHtml(externalId);

    // 2. HTML 파싱 (SSN 원문은 여기서 파싱, detail.ssn_raw에 임시 보관)
    const detail = parseContractDetailHtml(html, contractCode);

    // 3. 조직원 upsert (먼저 처리 - FK 의존)
    const memberData = normalizeSalesMember({
      sales_member_name: detail.sales_member_name,
      sales_member_external_id: detail.sales_member_external_id,
      org_rank: detail.org_name,
    });
    const salesMemberId = await upsertSalesMember(db, memberData);

    // 4. 고객 upsert (SSN 원문은 normalizeCustomer 내에서 masking 후 폐기)
    const customerData = normalizeCustomer(detail);
    const customerId = await upsertCustomer(db, customerData);

    // 5. 계약 upsert
    const contractData = normalizeContract(detail, customerId, salesMemberId);
    const { isNew } = await upsertContract(db, contractData);

    await log(db, runId, 'info', `계약 ${isNew ? '생성' : '갱신'}: ${contractCode}`);
    return isNew ? 'created' : 'updated';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, runId, 'error', `계약 처리 실패: ${contractCode}`, {
      external_id: externalId,
      error: message,
    });
    return 'error';
  }
}

// ─────────────────────────────────────────────
// 메인 sync 실행
// ─────────────────────────────────────────────

export interface SyncOptions {
  triggeredBy?: string;
  rowPerPage?: number;
}

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const { triggeredBy = 'manual', rowPerPage = 50 } = options;
  const db = createAdminSupabaseClient();
  const startedAt = Date.now();

  // sync_runs 레코드 생성
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
    await log(db, runId, 'info', '동기화 시작', { row_per_page: rowPerPage });

    // 전체 계약 목록 수집
    const allItems = await fetchAllContractPages(rowPerPage, (page, total) => {
      console.log(`[sync] 페이지 ${page} / ${Math.ceil(total / rowPerPage)} 수집 중...`);
    });

    totalFetched = allItems.length;
    await log(db, runId, 'info', `총 ${totalFetched}건 목록 수집 완료`);

    // 개별 처리
    for (const item of allItems) {
      const result = await processSingleContract(
        db,
        runId,
        String(item.id),
        item.contract_code,
      );

      if (result === 'created') totalCreated++;
      else if (result === 'updated') totalUpdated++;
      else if (result === 'error') totalErrors++;
    }

    // 완료 처리
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
