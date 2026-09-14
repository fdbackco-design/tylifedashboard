/**
 * 확정 지급 원장 기준 취소 환수(역분개).
 * - 현재 조직도/직급으로 재계산하지 않음
 * - UNIQUE 키로 재실행 멱등
 * - 본사만 환수 계약은 internal_exempt 로 내부 환수 합계에서 제외
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingLedgerTableError } from '@/lib/settlement/confirmed-payout-ledger';

/** 본사 환수만 — 내부(영업) 환수 전기 면제 */
export const INTERNAL_CLAWBACK_EXEMPT_CONTRACT_CODES: ReadonlySet<string> = new Set([
  'TY12720260716',
  'TY12820260716',
]);

export function isInternalClawbackExemptContractCode(
  contractCode: string | null | undefined,
): boolean {
  const code = String(contractCode ?? '').trim();
  return code.length > 0 && INTERNAL_CLAWBACK_EXEMPT_CONTRACT_CODES.has(code);
}

export type ClawbackEntryInput = {
  clawback_year_month: string;
  source_year_month: string;
  contract_code: string;
  contract_id: string | null;
  recipient_member_id: string;
  amount_type: 'personal' | 'rollup';
  amount_won: number;
  internal_exempt?: boolean;
  note?: string | null;
};

export type CancelledContractRef = {
  id: string;
  contract_code: string;
  is_cancelled: boolean;
  status: string | null;
};

function isCancelledContract(c: CancelledContractRef): boolean {
  if (c.is_cancelled) return true;
  const st = String(c.status ?? '');
  return st.includes('취소') || st.includes('해약') || st.includes('철회');
}

/**
 * 원장에 있는 계약 중 현재 취소된 것을 clawback_year_month 에 역분개 upsert.
 * internal_exempt 계약도 행은 남기되(감사), amount 합산 시 제외한다.
 */
export async function upsertClawbackEntriesFromCancelledContracts(
  db: SupabaseClient,
  args: {
    clawbackYearMonth: string;
    cancelledContracts: CancelledContractRef[];
  },
): Promise<{ upserted: number }> {
  const cancelledCodes = [
    ...new Set(
      args.cancelledContracts
        .filter(isCancelledContract)
        .map((c) => String(c.contract_code ?? '').trim())
        .filter(Boolean),
    ),
  ];
  if (cancelledCodes.length === 0) return { upserted: 0 };

  const { data: lines, error: lineErr } = await db
    .from('settlement_confirmed_payout_lines')
    .select(
      'source_year_month, contract_code, contract_id, recipient_member_id, amount_type, amount_won',
    )
    .in('contract_code', cancelledCodes)
    .gt('amount_won', 0);
  if (lineErr) {
    if (isMissingLedgerTableError(lineErr.message)) return { upserted: 0 };
    throw new Error(`환수 원장 조회 실패: ${lineErr.message}`);
  }

  const contractIdByCode = new Map(
    args.cancelledContracts.map((c) => [String(c.contract_code).trim(), c.id]),
  );

  const entries: ClawbackEntryInput[] = [];
  for (const line of (lines ?? []) as Array<{
    source_year_month: string;
    contract_code: string;
    contract_id: string | null;
    recipient_member_id: string;
    amount_type: 'personal' | 'rollup';
    amount_won: number;
  }>) {
    // 원정산월이 환수월보다 이후면 스킵(미래 원장 방어)
    if (String(line.source_year_month) >= args.clawbackYearMonth) continue;
    const code = String(line.contract_code).trim();
    const amount = Math.max(0, Math.round(Number(line.amount_won) || 0));
    if (!code || amount <= 0) continue;
    entries.push({
      clawback_year_month: args.clawbackYearMonth,
      source_year_month: String(line.source_year_month).slice(0, 7),
      contract_code: code,
      contract_id: line.contract_id ?? contractIdByCode.get(code) ?? null,
      recipient_member_id: String(line.recipient_member_id),
      amount_type: line.amount_type,
      amount_won: amount,
      internal_exempt: isInternalClawbackExemptContractCode(code),
      note: isInternalClawbackExemptContractCode(code)
        ? '본사 환수 전용(내부 환수 면제)'
        : '확정 지급 원장 역분개',
    });
  }

  if (entries.length === 0) return { upserted: 0 };

  const rows = entries.map((e) => ({
    clawback_year_month: e.clawback_year_month,
    source_year_month: e.source_year_month,
    contract_code: e.contract_code,
    contract_id: e.contract_id,
    recipient_member_id: e.recipient_member_id,
    amount_type: e.amount_type,
    amount_won: e.amount_won,
    internal_exempt: Boolean(e.internal_exempt),
    note: e.note ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db.from('settlement_clawback_entries').upsert(rows as any, {
    onConflict:
      'clawback_year_month,source_year_month,contract_code,recipient_member_id,amount_type',
  });
  if (error) {
    if (isMissingLedgerTableError(error.message)) return { upserted: 0 };
    throw new Error(`환수 전기 저장 실패: ${error.message}`);
  }
  return { upserted: rows.length };
}

/** 내부 환수 합계(면제 제외). 멤버별 양수 금액. */
export async function fetchLedgerClawbackAmountByMemberId(
  db: SupabaseClient,
  clawbackYearMonth: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data, error } = await db
    .from('settlement_clawback_entries')
    .select('recipient_member_id, amount_won, internal_exempt')
    .eq('clawback_year_month', clawbackYearMonth);
  if (error) {
    if (isMissingLedgerTableError(error.message)) return out;
    throw new Error(`환수 전기 조회 실패: ${error.message}`);
  }
  for (const r of (data ?? []) as Array<{
    recipient_member_id: string;
    amount_won: number;
    internal_exempt: boolean;
  }>) {
    if (r.internal_exempt) continue;
    const mid = String(r.recipient_member_id);
    const amt = Math.max(0, Math.round(Number(r.amount_won) || 0));
    out.set(mid, (out.get(mid) ?? 0) + amt);
  }
  return out;
}

/**
 * override.clawback_amount 를 원장 합계로 동기화(멱등 upsert).
 * 원장에 없는 멤버는 건드리지 않는다.
 */
export async function syncOverrideClawbacksFromLedger(
  db: SupabaseClient,
  clawbackYearMonth: string,
  amountByMemberId: Map<string, number>,
): Promise<void> {
  for (const [memberId, amount] of amountByMemberId.entries()) {
    const { data: existing } = await db
      .from('settlement_statement_overrides')
      .select('id, clawback_amount')
      .eq('year_month', clawbackYearMonth)
      .eq('member_id', memberId)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await db
        .from('settlement_statement_overrides')
        .update({ clawback_amount: amount, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw new Error(`환수 override 갱신 실패: ${error.message}`);
    } else {
      const { error } = await db.from('settlement_statement_overrides').insert({
        year_month: clawbackYearMonth,
        member_id: memberId,
        clawback_amount: amount,
      } as any);
      if (error) throw new Error(`환수 override 생성 실패: ${error.message}`);
    }
  }
}
