import type { SupabaseClient } from '@supabase/supabase-js';
import { isTyCarePlanContract, resolveHappycallEligibilityFields } from './galaxy-care-mu';
import { getHappycallWindowForYearMonth, happycallYmdSeoul } from './settlement-eligibility-v2';

export const CARE_PLAN_RECRUITMENT_PER_UNIT_WON = 18_182;
export const CARE_PLAN_MAINTENANCE_PER_UNIT_WON = 6_000;
export const CARE_PLAN_MAX_MAINTENANCE_INSTALLMENTS = 24;
export const CARE_PLAN_AUTOMATIC_FROM_YEAR_MONTH = '2026-09';

export type CarePlanCommissionLine = {
  contract_id: string | null;
  contract_code: string;
  recipient_member_id: string;
  earning_year_month: string;
  commission_type: 'recruitment' | 'maintenance' | 'retroactive';
  installment_no: number;
  unit_count: number;
  unit_amount_won: number;
  amount_won: number;
  override_amount_won?: number | null;
  payment_status: 'pending' | 'paid' | 'held' | 'void';
  source: 'automatic' | 'manual_retroactive' | 'manual';
  note?: string | null;
};

type CarePlanContractRow = {
  id: string;
  contract_code: string;
  unit_count: number | null;
  status: string | null;
  is_cancelled: boolean | null;
  happy_call_at: string | null;
  happycall_result: string | null;
  product_type: string | null;
  item_name: string | null;
  source_snapshot_json: Record<string, string | null> | null;
  sales_member_id: string | null;
  settlement_sales_member_id: string | null;
  updated_at: string | null;
};

function addMonths(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsBetween(fromYearMonth: string, toYearMonth: string): number {
  const [fy, fm] = fromYearMonth.split('-').map(Number);
  const [ty, tm] = toYearMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** 해피콜 일자가 속하는 26일~25일 정산월을 반환한다. */
export function carePlanRecruitmentYearMonth(happycallYmd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(happycallYmd)) return null;
  const calendarMonth = happycallYmd.slice(0, 7);
  for (const candidate of [calendarMonth, addMonths(calendarMonth, 1)]) {
    const window = getHappycallWindowForYearMonth(candidate);
    if (happycallYmd >= window.start_date && happycallYmd <= window.end_date) {
      return candidate;
    }
  }
  return null;
}

export function buildCarePlanAutomaticLine(args: {
  contract: CarePlanContractRow;
  yearMonth: string;
  cancellationYmd?: string | null;
}): CarePlanCommissionLine | null {
  const { contract, yearMonth, cancellationYmd = null } = args;
  if (!isTyCarePlanContract(contract)) return null;
  const recipient = contract.settlement_sales_member_id ?? contract.sales_member_id;
  if (!recipient) return null;

  const happycall = resolveHappycallEligibilityFields(
    contract.happy_call_at,
    contract.happycall_result,
  );
  if (happycall.result !== '성공' || !happycall.ymd) return null;
  const recruitmentMonth = carePlanRecruitmentYearMonth(happycall.ymd);
  if (!recruitmentMonth) return null;

  const targetWindow = getHappycallWindowForYearMonth(yearMonth);
  if (cancellationYmd && cancellationYmd <= targetWindow.end_date) return null;

  const installment = monthsBetween(recruitmentMonth, yearMonth);
  if (installment < 0 || installment > CARE_PLAN_MAX_MAINTENANCE_INSTALLMENTS) return null;
  const unitCount = Math.max(0, Math.floor(Number(contract.unit_count ?? 0)));
  if (unitCount <= 0) return null;

  const isRecruitment = installment === 0;
  const unitAmount = isRecruitment
    ? CARE_PLAN_RECRUITMENT_PER_UNIT_WON
    : CARE_PLAN_MAINTENANCE_PER_UNIT_WON;
  return {
    contract_id: contract.id,
    contract_code: contract.contract_code,
    recipient_member_id: recipient,
    earning_year_month: yearMonth,
    commission_type: isRecruitment ? 'recruitment' : 'maintenance',
    installment_no: installment,
    unit_count: unitCount,
    unit_amount_won: unitAmount,
    amount_won: unitCount * unitAmount,
    payment_status: 'pending',
    source: 'automatic',
    note: isRecruitment
      ? '해피콜 성공 모집수당(최초 1회)'
      : `해피콜 성공 다음 달부터 유지수당 ${installment}/24회`,
  };
}

function isMissingCarePlanSchema(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes('care_plan_commission') ||
    text.includes('care_plan_commission_entries') ||
    text.includes('schema cache')
  );
}

export async function calculateCarePlanCommissionsForMonth(
  db: SupabaseClient,
  yearMonth: string,
): Promise<{
  amountByMemberId: Map<string, number>;
  linesByMemberId: Map<string, CarePlanCommissionLine[]>;
}> {
  const empty = {
    amountByMemberId: new Map<string, number>(),
    linesByMemberId: new Map<string, CarePlanCommissionLine[]>(),
  };

  const { data: contracts, error: contractErr } = await db
    .from('contracts')
    .select(
      'id, contract_code, unit_count, status, is_cancelled, happy_call_at, happycall_result, product_type, item_name, source_snapshot_json, sales_member_id, settlement_sales_member_id, updated_at',
    )
    .eq('product_type', 'TY케어플랜');
  if (contractErr) throw new Error(`케어플랜 계약 조회 실패: ${contractErr.message}`);

  const careContracts = (contracts ?? []) as CarePlanContractRow[];
  const contractIds = careContracts.map((row) => row.id);
  const cancellationYmdByContractId = new Map<string, string>();
  if (contractIds.length > 0) {
    const { data: histories, error: historyErr } = await db
      .from('contract_status_histories')
      .select('contract_id, to_status, changed_at')
      .in('contract_id', contractIds)
      .in('to_status', ['취소', '해약'])
      .order('changed_at', { ascending: true });
    if (historyErr) throw new Error(`케어플랜 상태이력 조회 실패: ${historyErr.message}`);
    for (const row of (histories ?? []) as Array<{
      contract_id: string;
      to_status: string;
      changed_at: string;
    }>) {
      if (cancellationYmdByContractId.has(row.contract_id)) continue;
      const ymd = happycallYmdSeoul(row.changed_at);
      if (ymd) cancellationYmdByContractId.set(row.contract_id, ymd);
    }
  }

  if (yearMonth >= CARE_PLAN_AUTOMATIC_FROM_YEAR_MONTH) {
    const desired = careContracts
      .map((contract) => {
        let cancellationYmd = cancellationYmdByContractId.get(contract.id) ?? null;
        if (
          !cancellationYmd &&
          (contract.status === '해약' || contract.status === '취소' || contract.is_cancelled)
        ) {
          cancellationYmd = happycallYmdSeoul(contract.updated_at);
        }
        return buildCarePlanAutomaticLine({ contract, yearMonth, cancellationYmd });
      })
      .filter((line): line is CarePlanCommissionLine => line != null);

    const { data: existing, error: existingErr } = await db
      .from('care_plan_commission_entries')
      .select(
        'id, contract_code, commission_type, installment_no, payment_status, override_amount_won',
      )
      .eq('earning_year_month', yearMonth)
      .eq('source', 'automatic');
    if (existingErr) {
      if (isMissingCarePlanSchema(existingErr.message)) return empty;
      throw new Error(`케어플랜 지급원장 조회 실패: ${existingErr.message}`);
    }

    const existingByKey = new Map(
      (existing ?? []).map((row: any) => [
        `${row.contract_code}:${row.commission_type}:${row.installment_no}`,
        row,
      ]),
    );
    const desiredKeys = new Set<string>();
    for (const line of desired) {
      const key = `${line.contract_code}:${line.commission_type}:${line.installment_no}`;
      desiredKeys.add(key);
      const previous = existingByKey.get(key) as
        | { payment_status?: CarePlanCommissionLine['payment_status']; override_amount_won?: number | null }
        | undefined;
      line.payment_status = previous?.payment_status ?? 'pending';
      line.override_amount_won = previous?.override_amount_won ?? null;
    }

    if (desired.length > 0) {
      const { error: upsertErr } = await db
        .from('care_plan_commission_entries')
        .upsert(desired, { onConflict: 'contract_code,commission_type,installment_no' });
      if (upsertErr) throw new Error(`케어플랜 지급원장 저장 실패: ${upsertErr.message}`);
    }

    const voidIds = (existing ?? [])
      .filter(
        (row: any) =>
          !desiredKeys.has(`${row.contract_code}:${row.commission_type}:${row.installment_no}`) &&
          row.payment_status !== 'void',
      )
      .map((row: any) => String(row.id));
    if (voidIds.length > 0) {
      const { error: voidErr } = await db
        .from('care_plan_commission_entries')
        .update({
          payment_status: 'void',
          note: '해약/취소 또는 지급조건 미충족으로 해당 정산월 지급 제외',
        })
        .in('id', voidIds);
      if (voidErr) throw new Error(`케어플랜 지급제외 반영 실패: ${voidErr.message}`);
    }
  }

  const { data: payableRows, error: payableErr } = await db
    .from('care_plan_commission_entries')
    .select(
      'contract_id, contract_code, recipient_member_id, earning_year_month, commission_type, installment_no, unit_count, unit_amount_won, amount_won, override_amount_won, payment_status, source, note',
    )
    .eq('earning_year_month', yearMonth)
    .in('payment_status', ['pending', 'paid']);
  if (payableErr) {
    if (isMissingCarePlanSchema(payableErr.message)) return empty;
    throw new Error(`케어플랜 지급액 조회 실패: ${payableErr.message}`);
  }

  const linesByMemberId = new Map<string, CarePlanCommissionLine[]>();
  const automaticAmountByMemberId = new Map<string, number>();
  for (const raw of (payableRows ?? []) as CarePlanCommissionLine[]) {
    const line = {
      ...raw,
      amount_won:
        raw.override_amount_won == null ? Number(raw.amount_won) : Number(raw.override_amount_won),
    };
    const list = linesByMemberId.get(line.recipient_member_id) ?? [];
    list.push(line);
    linesByMemberId.set(line.recipient_member_id, list);
    automaticAmountByMemberId.set(
      line.recipient_member_id,
      (automaticAmountByMemberId.get(line.recipient_member_id) ?? 0) + line.amount_won,
    );
  }

  const { data: overrides, error: overrideErr } = await db
    .from('settlement_statement_overrides')
    .select('member_id, care_plan_commission')
    .eq('year_month', yearMonth);
  if (overrideErr && !isMissingCarePlanSchema(overrideErr.message)) {
    throw new Error(`케어플랜 수당 보정값 조회 실패: ${overrideErr.message}`);
  }
  const overrideByMemberId = new Map<string, number>();
  for (const row of (overrides ?? []) as Array<{
    member_id: string;
    care_plan_commission: number | null;
  }>) {
    if (row.care_plan_commission != null) {
      overrideByMemberId.set(row.member_id, Math.max(0, Number(row.care_plan_commission) || 0));
    }
  }

  const amountByMemberId = new Map(automaticAmountByMemberId);
  for (const [memberId, amount] of overrideByMemberId) amountByMemberId.set(memberId, amount);
  return { amountByMemberId, linesByMemberId };
}
