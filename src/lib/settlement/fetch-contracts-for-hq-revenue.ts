import type { SupabaseClient } from '@supabase/supabase-js';
import type { HqRevenueContractInput } from './hq-revenue';

const HQ_REVENUE_CONTRACT_SELECT =
  'id, join_date, unit_count, product_type, item_name, source_snapshot_json, status, is_cancelled, sales_member_id, sales_link_status, rental_request_no, invoice_no, invoice_registered_at, happycall_result, happy_call_at, settlement_deferred, deferred_to_month';

const PAGE_SIZE = 1000;

/**
 * 본사 매출 합계용 계약 전체 로드 (담당자 연결된 건만).
 * Supabase 기본 row limit(1000)을 넘는 데이터셋에서도 누락 없이 집계한다.
 */
export async function fetchAllContractsForHqRevenue(
  db: SupabaseClient,
): Promise<HqRevenueContractInput[]> {
  const rows: HqRevenueContractInput[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from('contracts')
      .select(HQ_REVENUE_CONTRACT_SELECT)
      .not('sales_member_id', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`HQ revenue contracts fetch failed: ${error.message}`);
    }

    const batch = (data ?? []) as HqRevenueContractInput[];
    if (batch.length === 0) break;

    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

/**
 * 정산 월 구간(join_date) 계약만 로드 — 이번달 매출·구좌 집계용.
 * 누적 매출(total)은 `fetchAllContractsForHqRevenue`가 필요하다.
 */
export async function fetchContractsForHqRevenueInPeriod(
  db: SupabaseClient,
  periodStart: string,
  periodEnd: string,
): Promise<HqRevenueContractInput[]> {
  const rows: HqRevenueContractInput[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await db
      .from('contracts')
      .select(HQ_REVENUE_CONTRACT_SELECT)
      .not('sales_member_id', 'is', null)
      .gte('join_date', periodStart)
      .lte('join_date', periodEnd)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`HQ revenue period contracts fetch failed: ${error.message}`);
    }

    const batch = (data ?? []) as HqRevenueContractInput[];
    if (batch.length === 0) break;

    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}
