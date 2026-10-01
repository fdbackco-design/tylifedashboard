/**
 * TY케어플랜 상태 전용 동기화.
 *
 * - 계약 목록만 조회하고 상세 페이지는 절대 조회하지 않는다.
 * - 고객/조직/승급/정산 후처리를 실행하지 않는다.
 * - status / is_cancelled / ty_source_status / 케어플랜 상품유형 / 상태이력 / watchlist만 갱신한다.
 * - 가입일부터 24개월이 지나거나 해약/취소가 확인되면 watchlist를 종료한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { fetchContractList } from './client';
import { normalizeDate, parseContractListHtml } from './html-parser';
import { normalizeStatus } from './normalize';
import { isTyCarePlanContract } from '@/lib/settlement/galaxy-care-mu';

const DEFAULT_ROW_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 300;
const TRACKING_MONTHS = 24;

function seoulTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addMonthsYmd(ymd: string, months: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function minusMonthsYmd(ymd: string, months: number): string {
  return addMonthsYmd(ymd, -months);
}

function isTerminal(status: string, isCancelled: boolean): boolean {
  return status === '해약' || status === '취소' || isCancelled;
}

function listItemIsCarePlan(item: {
  product_type_raw?: string | null;
  _snapshot?: Record<string, string | null>;
}): boolean {
  return isTyCarePlanContract({
    product_type: item.product_type_raw ?? null,
    source_snapshot_json: item._snapshot ?? null,
  });
}

async function seedWatchlistFromContracts(db: SupabaseClient, todayYmd: string): Promise<void> {
  const { data, error } = await db
    .from('contracts')
    .select('id, contract_code, join_date, status, is_cancelled')
    .eq('product_type', 'TY케어플랜');
  if (error) throw new Error(`케어플랜 watchlist 초기 조회 실패: ${error.message}`);

  const rows = (data ?? []).map((row: any) => {
    const joinedAt = String(row.join_date ?? '').slice(0, 10);
    const status = String(row.status ?? '');
    const cancelled = Boolean(row.is_cancelled);
    const expiresAt = addMonthsYmd(joinedAt, TRACKING_MONTHS);
    const terminal = isTerminal(status, cancelled);
    return {
      contract_id: String(row.id),
      contract_code: String(row.contract_code),
      joined_at: joinedAt,
      tracking_expires_at: expiresAt,
      is_active: !terminal && expiresAt >= todayYmd,
      terminal_status: terminal ? status : null,
      terminal_at: terminal ? new Date().toISOString() : null,
    };
  });
  if (rows.length === 0) return;

  const { error: upsertErr } = await db
    .from('care_plan_contract_watchlist')
    .upsert(rows, { onConflict: 'contract_id' });
  if (upsertErr) throw new Error(`케어플랜 watchlist 초기화 실패: ${upsertErr.message}`);
}

export type CarePlanStatusSyncResult = {
  run_id: string;
  status: 'completed' | 'failed';
  pages_scanned: number;
  rows_scanned: number;
  care_plan_rows_seen: number;
  contracts_updated: number;
  histories_created: number;
  missing_contracts: number;
  duration_ms: number;
};

export async function runCarePlanStatusSync(options?: {
  rowPerPage?: number;
  maxPages?: number;
}): Promise<CarePlanStatusSyncResult> {
  const started = Date.now();
  const db = createAdminSupabaseClient();
  const rowPerPage =
    options?.rowPerPage ??
    Math.max(1, Number.parseInt(process.env.TYLIFE_CARE_PLAN_SYNC_PAGE_SIZE ?? '', 10) || DEFAULT_ROW_PER_PAGE);
  const maxPages =
    options?.maxPages ??
    Math.max(1, Number.parseInt(process.env.TYLIFE_CARE_PLAN_SYNC_MAX_PAGES ?? '', 10) || DEFAULT_MAX_PAGES);

  const { data: run, error: runErr } = await db
    .from('sync_runs')
    .insert({ status: 'running', triggered_by: 'care-plan-status-daily' })
    .select('id')
    .single();
  if (runErr || !run?.id) throw new Error(`케어플랜 sync_run 생성 실패: ${runErr?.message ?? 'id missing'}`);
  const runId = String(run.id);

  let pagesScanned = 0;
  let rowsScanned = 0;
  let carePlanRowsSeen = 0;
  let contractsUpdated = 0;
  let historiesCreated = 0;
  let missingContracts = 0;

  try {
    const todayYmd = seoulTodayYmd();
    const cutoffYmd = minusMonthsYmd(todayYmd, TRACKING_MONTHS);
    await seedWatchlistFromContracts(db, todayYmd);

    const { data: watchRows, error: watchErr } = await db
      .from('care_plan_contract_watchlist')
      .select('contract_code')
      .eq('is_active', true)
      .gte('tracking_expires_at', todayYmd);
    if (watchErr) throw new Error(`케어플랜 watchlist 조회 실패: ${watchErr.message}`);
    const watchedCodes = new Set(
      (watchRows ?? []).map((row: any) => String(row.contract_code)).filter(Boolean),
    );

    for (let page = 1; page <= maxPages; page++) {
      const response = await fetchContractList(page, rowPerPage);
      const items = parseContractListHtml(response.data?.listHtml ?? '');
      pagesScanned++;
      rowsScanned += items.length;

      const candidates = items.filter(
        (item) => listItemIsCarePlan(item) || watchedCodes.has(item.contract_code),
      );
      carePlanRowsSeen += candidates.length;

      if (candidates.length > 0) {
        const codes = [...new Set(candidates.map((item) => item.contract_code))];
        const { data: contracts, error: contractsErr } = await db
          .from('contracts')
          .select('id, contract_code, join_date, status, is_cancelled, product_type')
          .in('contract_code', codes);
        if (contractsErr) throw new Error(`케어플랜 상태 대상 조회 실패: ${contractsErr.message}`);
        const contractByCode = new Map(
          (contracts ?? []).map((row: any) => [String(row.contract_code), row]),
        );

        for (const item of candidates) {
          const contract = contractByCode.get(item.contract_code) as any;
          if (!contract) {
            missingContracts++;
            continue;
          }

          const previousStatus = String(contract.status ?? '');
          const nextStatus = normalizeStatus(item.status_raw ?? '');
          const nextCancelled = Boolean(item.is_cancelled);
          const changed = previousStatus !== nextStatus;
          const nowIso = new Date().toISOString();

          const { error: updateErr } = await db
            .from('contracts')
            .update({
              status: nextStatus,
              ty_source_status: nextStatus,
              is_cancelled: nextCancelled,
              // 과거 `일반`으로 저장된 계약과 신규 목록 계약을 canonical 유형으로 보정한다.
              product_type: 'TY케어플랜',
              item_name: '',
            })
            .eq('id', contract.id);
          if (updateErr) throw new Error(`케어플랜 계약 상태 갱신 실패: ${updateErr.message}`);
          contractsUpdated++;

          if (changed) {
            const { error: historyErr } = await db.from('contract_status_histories').insert({
              contract_id: contract.id,
              from_status: previousStatus || null,
              to_status: nextStatus,
              changed_by: 'care-plan-status-sync',
              note: '24개월 케어플랜 목록 전용 동기화',
            });
            if (historyErr) throw new Error(`케어플랜 상태이력 저장 실패: ${historyErr.message}`);
            historiesCreated++;
          }

          const joinedAt =
            normalizeDate(item.joined_at_raw ?? '') || String(contract.join_date ?? '').slice(0, 10);
          const expiresAt = addMonthsYmd(joinedAt, TRACKING_MONTHS);
          const terminal = isTerminal(nextStatus, nextCancelled);
          const { error: watchUpsertErr } = await db
            .from('care_plan_contract_watchlist')
            .upsert(
              {
                contract_id: contract.id,
                contract_code: contract.contract_code,
                joined_at: joinedAt,
                tracking_expires_at: expiresAt,
                is_active: !terminal && expiresAt >= todayYmd,
                terminal_status: terminal ? nextStatus : null,
                terminal_at: terminal ? nowIso : null,
                last_checked_at: nowIso,
              },
              { onConflict: 'contract_id' },
            );
          if (watchUpsertErr) {
            throw new Error(`케어플랜 watchlist 갱신 실패: ${watchUpsertErr.message}`);
          }
        }
      }

      const oldestDate = [...items]
        .reverse()
        .map((item) => normalizeDate(item.joined_at_raw ?? ''))
        .find(Boolean);
      if (items.length < rowPerPage || (oldestDate && oldestDate < cutoffYmd)) break;
    }

    const result: CarePlanStatusSyncResult = {
      run_id: runId,
      status: 'completed',
      pages_scanned: pagesScanned,
      rows_scanned: rowsScanned,
      care_plan_rows_seen: carePlanRowsSeen,
      contracts_updated: contractsUpdated,
      histories_created: historiesCreated,
      missing_contracts: missingContracts,
      duration_ms: Date.now() - started,
    };
    await db
      .from('sync_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_fetched: rowsScanned,
        total_created: 0,
        total_updated: contractsUpdated,
        total_errors: 0,
      })
      .eq('id', runId);
    return result;
  } catch (error) {
    await db
      .from('sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        total_fetched: rowsScanned,
        total_created: 0,
        total_updated: contractsUpdated,
        total_errors: 1,
      })
      .eq('id', runId);
    throw error;
  }
}
