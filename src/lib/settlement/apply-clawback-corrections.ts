/**
 * 팀장 검증 환수/확정액 보정 적용.
 * - 7월 임태순 580만 고정(is_finalized)
 * - 8월 clawback_amount 를 원수령자 기준으로 맞춤
 * - 원장 테이블이 있으면 시드 라인/환수 전기도 upsert
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingLedgerTableError } from '@/lib/settlement/confirmed-payout-ledger';
import {
  AUGUST_2026_CLAWBACK_BY_MEMBER_ID,
  AUGUST_2026_CLAWBACK_CLEAR_MEMBER_IDS,
  CONFIRMED_PAYOUT_SEED_LINES,
  MEMBER_IDS,
} from '@/lib/settlement/confirmed-payout-seeds';
import { patchMonthlySettlementTotalForClawback } from '@/lib/settlement/patch-clawback-total';

async function upsertSeedLedger(db: SupabaseClient): Promise<boolean> {
  const payoutRows = CONFIRMED_PAYOUT_SEED_LINES.map((l) => ({
    source_year_month: l.source_year_month,
    contract_code: l.contract_code,
    contract_id: l.contract_id,
    recipient_member_id: l.recipient_member_id,
    amount_type: l.amount_type,
    amount_won: l.amount_won,
    unit_count: l.unit_count,
    frozen: true,
    note: l.note ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error: pErr } = await db
    .from('settlement_confirmed_payout_lines')
    .upsert(payoutRows as any, {
      onConflict: 'source_year_month,contract_code,recipient_member_id,amount_type',
    });
  if (pErr) {
    if (isMissingLedgerTableError(pErr.message)) return false;
    throw new Error(pErr.message);
  }

  const clawRows = CONFIRMED_PAYOUT_SEED_LINES.map((l) => ({
    clawback_year_month: '2026-08',
    source_year_month: l.source_year_month,
    contract_code: l.contract_code,
    contract_id: l.contract_id,
    recipient_member_id: l.recipient_member_id,
    amount_type: l.amount_type,
    amount_won: l.amount_won,
    internal_exempt: false,
    note: `시드 역분개(${l.note ?? ''})`,
    updated_at: new Date().toISOString(),
  }));
  const { error: cErr } = await db.from('settlement_clawback_entries').upsert(clawRows as any, {
    onConflict:
      'clawback_year_month,source_year_month,contract_code,recipient_member_id,amount_type',
  });
  if (cErr) {
    if (isMissingLedgerTableError(cErr.message)) return false;
    throw new Error(cErr.message);
  }
  return true;
}

async function setClawbackOverride(
  db: SupabaseClient,
  yearMonth: string,
  memberId: string,
  nextAmount: number,
): Promise<void> {
  const { data: existing } = await db
    .from('settlement_statement_overrides')
    .select('id, clawback_amount')
    .eq('year_month', yearMonth)
    .eq('member_id', memberId)
    .maybeSingle();
  const prev =
    existing && (existing as { clawback_amount: number | null }).clawback_amount != null
      ? Number((existing as { clawback_amount: number | null }).clawback_amount)
      : null;

  if (existing?.id) {
    const { error } = await db
      .from('settlement_statement_overrides')
      .update({ clawback_amount: nextAmount, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await db.from('settlement_statement_overrides').insert({
      year_month: yearMonth,
      member_id: memberId,
      clawback_amount: nextAmount,
    } as any);
    if (error) throw new Error(error.message);
  }

  await patchMonthlySettlementTotalForClawback(db, memberId, yearMonth, prev, nextAmount);
}

export async function applyTeamVerifiedClawbackCorrections(db: SupabaseClient): Promise<{
  ledger_upserted: boolean;
  july_im_total: number | null;
  august_clawbacks: Record<string, number>;
}> {
  let ledger_upserted = false;
  try {
    ledger_upserted = await upsertSeedLedger(db);
  } catch (e) {
    console.warn('[clawback-corrections] ledger seed skipped', e);
  }

  // 7월 임태순 580만 고정
  const imId = MEMBER_IDS.임태순;
  const { data: julyRow, error: jErr } = await db
    .from('monthly_settlements')
    .select('id, total_amount, rollup_commission, calculation_detail, is_finalized')
    .eq('year_month', '2026-07')
    .eq('member_id', imId)
    .maybeSingle();
  if (jErr) throw new Error(jErr.message);

  let july_im_total: number | null = null;
  if (julyRow?.id) {
    const prevTotal = Number((julyRow as any).total_amount ?? 0) || 0;
    const target = 5_800_000;
    const delta = target - prevTotal;
    const prevRollup = Number((julyRow as any).rollup_commission ?? 0) || 0;
    const detail = {
      ...(((julyRow as any).calculation_detail ?? {}) as object),
      confirmed_payout_freeze: {
        target_total: target,
        restored_delta: delta,
        note: '7월 확정 580만 고정. 취소 환수는 8월 역분개.',
      },
    };
    const { error } = await db
      .from('monthly_settlements')
      .update({
        total_amount: target,
        rollup_commission: Math.max(0, prevRollup + Math.max(0, delta)),
        calculation_detail: detail,
        is_finalized: true,
      } as any)
      .eq('id', julyRow.id);
    if (error) throw new Error(error.message);
    july_im_total = target;
  }

  const august_clawbacks: Record<string, number> = {};
  for (const [mid, amt] of AUGUST_2026_CLAWBACK_BY_MEMBER_ID.entries()) {
    await setClawbackOverride(db, '2026-08', mid, amt);
    august_clawbacks[mid] = amt;
  }
  for (const mid of AUGUST_2026_CLAWBACK_CLEAR_MEMBER_IDS) {
    await setClawbackOverride(db, '2026-08', mid, 0);
    august_clawbacks[mid] = 0;
  }

  return { ledger_upserted, july_im_total, august_clawbacks };
}
