import type { SupabaseClient } from '@supabase/supabase-js';

/** 케어플랜 수당 override 변경 직후 monthly_settlements.total_amount를 차액 보정한다. */
export async function patchMonthlySettlementTotalForCarePlan(
  db: SupabaseClient,
  memberId: string,
  yearMonth: string,
  previousOverride: number | null,
  nextOverride: number | null,
): Promise<{ ok: true; total_amount: number | null } | { ok: false; error: string }> {
  const { data: settlement, error } = await db
    .from('monthly_settlements')
    .select('id, care_plan_commission, total_amount')
    .eq('year_month', yearMonth)
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!settlement) return { ok: true, total_amount: null };

  const { data: entries, error: entriesError } = await db
    .from('care_plan_commission_entries')
    .select('amount_won, override_amount_won')
    .eq('earning_year_month', yearMonth)
    .eq('recipient_member_id', memberId)
    .in('payment_status', ['pending', 'paid']);
  if (entriesError) return { ok: false, error: entriesError.message };

  const automatic = (entries ?? []).reduce(
    (sum, row) =>
      sum +
      Math.max(
        0,
        Number(row.override_amount_won == null ? row.amount_won : row.override_amount_won) || 0,
      ),
    0,
  );
  const previousEffective =
    previousOverride == null
      ? Math.max(0, Number(settlement.care_plan_commission ?? 0) || 0)
      : Math.max(0, Number(previousOverride) || 0);
  const nextEffective = nextOverride == null ? automatic : Math.max(0, Number(nextOverride) || 0);

  const nextTotal =
    (Number(settlement.total_amount ?? 0) || 0) - previousEffective + nextEffective;
  const { error: updateError } = await db
    .from('monthly_settlements')
    .update({
      care_plan_commission: nextEffective,
      total_amount: nextTotal,
    })
    .eq('id', settlement.id);
  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, total_amount: nextTotal };
}
