/**
 * 월정산 확정 지급 원장.
 * - 계산 결과(calculation_detail)에서 계약×수령자 배분을 추출·저장
 * - frozen=true 이면 재계산이 덮어쓰지 않음
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SettlementCalculationDetail } from '@/lib/types/settlement';

export type ConfirmedPayoutAmountType = 'personal' | 'rollup';

export type ConfirmedPayoutLine = {
  source_year_month: string;
  contract_code: string;
  contract_id: string | null;
  recipient_member_id: string;
  amount_type: ConfirmedPayoutAmountType;
  amount_won: number;
  unit_count: number;
  frozen?: boolean;
  note?: string | null;
};

export function extractConfirmedPayoutLinesFromDetail(
  detail: SettlementCalculationDetail | null | undefined,
): ConfirmedPayoutLine[] {
  if (!detail?.member_id || !detail.year_month) return [];
  const recipient = String(detail.member_id);
  const ym = String(detail.year_month).slice(0, 7);
  const out: ConfirmedPayoutLine[] = [];

  for (const c of detail.direct_contracts ?? []) {
    const code = String(c.contract_code ?? '').trim();
    if (!code) continue;
    const amount = Math.max(0, Math.round(Number(c.subtotal) || 0));
    if (amount <= 0) continue;
    out.push({
      source_year_month: ym,
      contract_code: code,
      contract_id: c.contract_id ? String(c.contract_id) : null,
      recipient_member_id: recipient,
      amount_type: 'personal',
      amount_won: amount,
      unit_count: Number(c.unit_count) || 0,
    });
  }

  for (const c of detail.rollup_contract_items ?? []) {
    const code = String(c.contract_code ?? '').trim();
    if (!code) continue;
    const amount = Math.max(0, Math.round(Number(c.subtotal) || 0));
    if (amount <= 0) continue;
    out.push({
      source_year_month: ym,
      contract_code: code,
      contract_id: c.contract_id ? String(c.contract_id) : null,
      recipient_member_id: recipient,
      amount_type: 'rollup',
      amount_won: amount,
      unit_count: Number(c.unit_count) || 0,
    });
  }

  return out;
}

/**
 * 미동결(frozen=false) 라인만 upsert.
 * 이미 frozen 인 (month, contract, recipient, type) 은 유지.
 */
export async function upsertUnfrozenConfirmedPayoutLines(
  db: SupabaseClient,
  lines: ConfirmedPayoutLine[],
): Promise<{ upserted: number; skipped_frozen: number }> {
  if (lines.length === 0) return { upserted: 0, skipped_frozen: 0 };

  const codes = [...new Set(lines.map((l) => l.contract_code))];
  const months = [...new Set(lines.map((l) => l.source_year_month))];
  const { data: existing, error: exErr } = await db
    .from('settlement_confirmed_payout_lines')
    .select('source_year_month, contract_code, recipient_member_id, amount_type, frozen')
    .in('source_year_month', months)
    .in('contract_code', codes);
  if (exErr) {
    if (isMissingLedgerTableError(exErr.message)) return { upserted: 0, skipped_frozen: 0 };
    throw new Error(`확정 지급 원장 조회 실패: ${exErr.message}`);
  }

  const frozenKeys = new Set(
    ((existing ?? []) as Array<{
      source_year_month: string;
      contract_code: string;
      recipient_member_id: string;
      amount_type: string;
      frozen: boolean;
    }>)
      .filter((r) => r.frozen)
      .map(
        (r) =>
          `${r.source_year_month}|${r.contract_code}|${r.recipient_member_id}|${r.amount_type}`,
      ),
  );

  const toUpsert = lines.filter((l) => {
    const key = `${l.source_year_month}|${l.contract_code}|${l.recipient_member_id}|${l.amount_type}`;
    return !frozenKeys.has(key);
  });
  const skipped_frozen = lines.length - toUpsert.length;
  if (toUpsert.length === 0) return { upserted: 0, skipped_frozen };

  const rows = toUpsert.map((l) => ({
    source_year_month: l.source_year_month,
    contract_code: l.contract_code,
    contract_id: l.contract_id,
    recipient_member_id: l.recipient_member_id,
    amount_type: l.amount_type,
    amount_won: l.amount_won,
    unit_count: l.unit_count,
    frozen: Boolean(l.frozen),
    note: l.note ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db.from('settlement_confirmed_payout_lines').upsert(rows as any, {
    onConflict: 'source_year_month,contract_code,recipient_member_id,amount_type',
  });
  if (error) throw new Error(`확정 지급 원장 저장 실패: ${error.message}`);
  return { upserted: rows.length, skipped_frozen };
}

export async function freezeConfirmedPayoutMonth(
  db: SupabaseClient,
  sourceYearMonth: string,
): Promise<number> {
  const { data, error } = await db
    .from('settlement_confirmed_payout_lines')
    .update({ frozen: true, updated_at: new Date().toISOString() })
    .eq('source_year_month', sourceYearMonth)
    .eq('frozen', false)
    .select('id');
  if (error) {
    if (isMissingLedgerTableError(error.message)) return 0;
    throw new Error(`확정 지급 원장 동결 실패: ${error.message}`);
  }
  return (data ?? []).length;
}

export function isMissingLedgerTableError(message: string | null | undefined): boolean {
  const msg = String(message ?? '').toLowerCase();
  return (
    (msg.includes('settlement_confirmed_payout_lines') ||
      msg.includes('settlement_clawback_entries')) &&
    (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('could not find'))
  );
}
