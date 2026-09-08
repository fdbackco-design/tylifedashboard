import type { SupabaseClient } from '@supabase/supabase-js';

export function isMissingClawbackColumnError(message: string | null | undefined): boolean {
  const msg = String(message ?? '').toLowerCase();
  if (!msg.includes('clawback_amount')) return false;
  return (
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find') ||
    msg.includes('column')
  );
}

export const CLAWBACK_MIGRATION_ERROR =
  '환수금 컬럼 마이그레이션이 필요합니다. supabase/migrations/20260908010000_settlement_clawback_amount.sql 을 적용해주세요.';

/**
 * 해당 월 override 행의 clawback_amount.
 * 컬럼이 아직 없으면 빈 맵(미입력)으로 떨어진다.
 */
export async function fetchClawbackAmountByMemberId(
  db: SupabaseClient,
  yearMonth: string,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const { data, error } = await db
    .from('settlement_statement_overrides')
    .select('member_id, clawback_amount')
    .eq('year_month', yearMonth);
  if (error) {
    if (isMissingClawbackColumnError(error.message)) return out;
    throw new Error(error.message);
  }
  for (const r of (data ?? []) as Array<{ member_id: string; clawback_amount: number | null }>) {
    if (!r?.member_id) continue;
    out.set(String(r.member_id), r.clawback_amount);
  }
  return out;
}
