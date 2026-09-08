import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClawbackWon } from './manual-adjustment';

/**
 * 환수금 변경 직후 monthly_settlements.total_amount 를 차액만큼 보정한다.
 * 재계산 없이도 정산 현황 합계가 맞도록 한다.
 */
export async function patchMonthlySettlementTotalForClawback(
  db: SupabaseClient,
  memberId: string,
  yearMonth: string,
  prevDbClawback: number | null,
  nextDbClawback: number | null,
): Promise<{ ok: true; total_amount: number | null } | { ok: false; error: string }> {
  const prevClawback = resolveClawbackWon(memberId, yearMonth, prevDbClawback);
  const nextClawback = resolveClawbackWon(memberId, yearMonth, nextDbClawback);
  if (prevClawback === nextClawback) return { ok: true, total_amount: null };

  const { data: settlement, error: sErr } = await db
    .from('monthly_settlements')
    .select('id, total_amount, total_unit_count')
    .eq('year_month', yearMonth)
    .eq('member_id', memberId)
    .maybeSingle();
  if (sErr) return { ok: false, error: sErr.message };
  if (!settlement) return { ok: true, total_amount: null };

  const unitCount = Number((settlement as { total_unit_count?: number | null }).total_unit_count ?? 0) || 0;
  const prevTotal = Number((settlement as { total_amount?: number | null }).total_amount ?? 0) || 0;
  const nextTotal = unitCount === 0 ? 0 : prevTotal + prevClawback - nextClawback;
  const { error: uErr } = await db
    .from('monthly_settlements')
    .update({ total_amount: nextTotal })
    .eq('id', (settlement as { id: string }).id);
  if (uErr) return { ok: false, error: uErr.message };
  return { ok: true, total_amount: nextTotal };
}
