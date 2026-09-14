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

  // 7월 임태순 580만 고정 + 취소 4건 롤업 상세 복원(합계 일치)
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
    const target = 5_800_000;
    const targetRollup = 3_200_000;
    const detail = structuredClone(((julyRow as any).calculation_detail ?? {}) as Record<string, unknown>);
    const restoredContracts = [
      {
        id: '88a892e9-8652-4ed1-8649-614cebc99cae',
        contract_code: 'TY23620260727',
        join_date: '2026-07-27',
        happy_call_ymd: '2026-07-28',
        effective_sales_member_id: MEMBER_IDS.정철희,
        effective_sales_member_name: '정철희',
        effective_sales_member_rank: '영업사원',
        org_path_label: '임태순 → 황새로미 → 박미선 → 정철희',
      },
      {
        id: '7b6a1c1d-bdb8-4f80-9f7e-5238800376f8',
        contract_code: 'TY23720260727',
        join_date: '2026-07-27',
        happy_call_ymd: '2026-07-28',
        effective_sales_member_id: MEMBER_IDS.정철희,
        effective_sales_member_name: '정철희',
        effective_sales_member_rank: '영업사원',
        org_path_label: '임태순 → 황새로미 → 박미선 → 정철희',
      },
      {
        id: '5318c9fa-f9ef-4659-a1fb-9bb349ddfcbc',
        contract_code: 'TY27720260724',
        join_date: '2026-07-24',
        happy_call_ymd: '2026-07-28',
        effective_sales_member_id: MEMBER_IDS.이지현,
        effective_sales_member_name: '이지현',
        effective_sales_member_rank: '리더',
        org_path_label: '임태순 → 황새로미 → 이지현',
      },
      {
        id: 'e963d974-8f17-4f22-b9b7-245a2da880e7',
        contract_code: 'TY27820260724',
        join_date: '2026-07-24',
        happy_call_ymd: '2026-07-28',
        effective_sales_member_id: MEMBER_IDS.이지현,
        effective_sales_member_name: '이지현',
        effective_sales_member_rank: '리더',
        org_path_label: '임태순 → 황새로미 → 이지현',
      },
    ] as const;
    const restoredCodes = new Set<string>(restoredContracts.map((c) => c.contract_code));
    const existingRollupContracts = Array.isArray(detail.rollup_contract_items)
      ? (detail.rollup_contract_items as Array<Record<string, unknown>>)
      : [];
    const kept = existingRollupContracts.filter(
      (r) => !restoredCodes.has(String(r.contract_code ?? '')),
    );
    const restoredItems = restoredContracts.map((c) => ({
      subtotal: 100_000,
      from_rank: '리더',
      unit_count: 1,
      contract_id: c.id,
      contract_code: c.contract_code,
      from_member_id: MEMBER_IDS.황새로미,
      from_member_name: '황새로미',
      org_path_label: c.org_path_label,
      included_reason: 'confirmed_payout_freeze_restore',
      contract_join_date: c.join_date,
      upper_rank_applied: '센터장',
      rollup_amount_per_unit: 100_000,
      contract_happy_call_ymd: c.happy_call_ymd,
      effective_sales_member_id: c.effective_sales_member_id,
      effective_sales_member_name: c.effective_sales_member_name,
      effective_sales_member_rank: c.effective_sales_member_rank,
      center_chief_rollup_segment: 'CENTER_AFTER_PROMOTION',
      lower_direct_commission_per_unit: 400_000,
      upper_direct_commission_per_unit: 500_000,
    }));
    detail.rollup_contract_items = [...kept, ...restoredItems];

    const rollupItems = Array.isArray(detail.rollup_items)
      ? [...(detail.rollup_items as Array<Record<string, unknown>>)]
      : [];
    const hwangIdx = rollupItems.findIndex(
      (r) => String(r.from_member_id) === MEMBER_IDS.황새로미,
    );
    const restoredUnits = restoredItems.length;
    const restoredAmount = restoredItems.reduce((s, x) => s + x.subtotal, 0);
    // kept 합 + 복원분으로 황새로미 멤버 롤업을 재맞춤
    const keptHwangContracts = kept.filter(
      (r) => String(r.from_member_id) === MEMBER_IDS.황새로미,
    );
    const hwangUnits =
      keptHwangContracts.reduce((s, r) => s + Number(r.unit_count || 0), 0) + restoredUnits;
    const hwangSubtotal =
      keptHwangContracts.reduce((s, r) => s + Number(r.subtotal || 0), 0) + restoredAmount;
    const hwangRow = {
      from_member_id: MEMBER_IDS.황새로미,
      from_member_name: '황새로미',
      from_rank: '리더',
      unit_count: hwangUnits,
      rollup_amount_per_unit: hwangUnits > 0 ? hwangSubtotal / hwangUnits : 100_000,
      subtotal: hwangSubtotal,
    };
    if (hwangIdx >= 0) rollupItems[hwangIdx] = hwangRow;
    else rollupItems.push(hwangRow);
    detail.rollup_items = rollupItems;

    detail.confirmed_payout_freeze = {
      target_total: target,
      restored_rollup_amount: restoredAmount,
      restored_contracts: [...restoredCodes],
      note: '7월 확정 580만 고정. TY236/237/277/278 롤업 40만 복원. 취소 환수는 8월 역분개.',
    };

    const { error } = await db
      .from('monthly_settlements')
      .update({
        total_amount: target,
        rollup_commission: targetRollup,
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
