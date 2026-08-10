/**
 * 지급명세서(영업자별 공유용 / 관리자 settlement_sheet) 표시 전용 도메인 헬퍼.
 *
 * - 정산 계산 로직은 변경하지 않는다.
 * - `monthly_settlements` 의 원본값을 기본으로 하고, `settlement_statement_overrides`
 *   에 보정값이 있으면 표시 단계에서만 덮어쓴다.
 *
 * 본 모듈은 server-only.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSettlementWindowForYearMonth, getSettlementWindowDisplayForYearMonth } from './settlement-window';
import { sumDownlineAttributedUnitsInSettlementWindow } from '@/lib/organization/statement-downline-units';
import type { RankType } from '@/lib/types';

export interface StatementOverrideRow {
  id: string;
  year_month: string;
  member_id: string;
  personal_unit_count: number | null;
  downline_unit_count: number | null;
  personal_commission: number | null;
  override_amount: number | null;
  bonus_amount: number | null;
  memo: string | null;
  updated_at: string;
}

export interface StatementSheetMember {
  id: string;
  name: string;
  rank: RankType;
  external_id: string | null;
  phone: string | null;
  leader_rank_effective_at: string | null;
}

export interface StatementSheetData {
  yearMonth: string;
  labelYearMonth: string;
  /** 데이터 필터·계산용 윈도우(전월26~당월25, 보정 없음) */
  dataWindow: { start_date: string; end_date: string };
  /** 화면 표시용 윈도우(공휴일/주말 보정) */
  displayWindow: { start_date: string; end_date: string };
  member: StatementSheetMember;

  /** 화면에 표시할 최종값(보정 반영) */
  personalUnitCount: number;
  downlineUnitCount: number;
  totalUnitCount: number;
  personalCommission: number;
  overrideAmount: number;
  bonusAmount: number;
  /** = personalCommission + overrideAmount + bonusAmount */
  grossTotal: number;
  /** = floor(grossTotal * 0.033) */
  withholdingTax: number;
  /** = grossTotal - withholdingTax */
  netPayment: number;

  /** monthly_settlements 원본값 (override 적용 전) — 보정 화면 default 표시에 사용 */
  base: {
    direct_unit_count: number;
    downline_unit_count: number;
    base_commission: number;
    rollup_commission: number;
    incentive_amount: number;
    total_amount: number;
  };
  override: StatementOverrideRow | null;
}

interface MonthlySettlementsRow {
  year_month: string;
  member_id: string;
  rank: RankType;
  direct_unit_count: number | null;
  base_commission: number | null;
  rollup_commission: number | null;
  incentive_amount: number | null;
  total_amount: number | null;
}

const TAX_RATE = 0.033;

function floorNonNegative(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** override 행에서 NULL 이 아닌 값만 적용. NULL 이면 default. */
function pickOverride<T extends number>(override: T | null | undefined, fallback: number): number {
  if (override == null) return fallback;
  if (!Number.isFinite(override)) return fallback;
  return override;
}

/**
 * 단일 영업자(member)의 지급명세서 표시값을 만든다.
 *
 * - member: 표시할 영업자 (id, name, rank, external_id, phone, leader_rank_effective_at)
 * - downlineUnitCount: 사전 계산된 산하 실적 (없으면 함수 내부에서 계산)
 */
export async function buildStatementSheetData(
  db: SupabaseClient,
  yearMonth: string,
  member: StatementSheetMember,
  options?: {
    /** 미리 계산된 산하 실적값 (대량 처리시 외부에서 계산해 전달) */
    precomputedDownlineUnitCount?: number;
    /** 외부에서 monthly_settlements 행을 이미 가져왔다면 전달. 미전달시 내부 조회. */
    precomputedSettlement?: MonthlySettlementsRow | null;
    /** 외부에서 override 행을 이미 가져왔다면 전달. 미전달시 내부 조회. */
    precomputedOverride?: StatementOverrideRow | null;
  },
): Promise<StatementSheetData> {
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);
  const displayWindow = getSettlementWindowDisplayForYearMonth(yearMonth);

  let settlementRow: MonthlySettlementsRow | null;
  if (options?.precomputedSettlement !== undefined) {
    settlementRow = options.precomputedSettlement;
  } else {
    const r = await db
      .from('monthly_settlements')
      .select('year_month, member_id, rank, direct_unit_count, base_commission, rollup_commission, incentive_amount, total_amount')
      .eq('year_month', label_year_month)
      .eq('member_id', member.id)
      .maybeSingle();
    settlementRow = (r.data ?? null) as MonthlySettlementsRow | null;
  }

  let override: StatementOverrideRow | null;
  if (options?.precomputedOverride !== undefined) {
    override = options.precomputedOverride;
  } else {
    const r = await db
      .from('settlement_statement_overrides')
      .select('id, year_month, member_id, personal_unit_count, downline_unit_count, personal_commission, override_amount, bonus_amount, memo, updated_at')
      .eq('year_month', label_year_month)
      .eq('member_id', member.id)
      .maybeSingle();
    override = (r.data ?? null) as StatementOverrideRow | null;
  }

  // 기본값 산출
  const baseDirectUnits = settlementRow?.direct_unit_count ?? 0;
  let baseDownlineUnits = options?.precomputedDownlineUnitCount;
  if (baseDownlineUnits == null) {
    const downlineRes = await sumDownlineAttributedUnitsInSettlementWindow(
      db,
      member.id,
      { start_date, end_date },
      baseDirectUnits,
      member.leader_rank_effective_at ?? null,
    );
    baseDownlineUnits = typeof downlineRes === 'number' ? downlineRes : downlineRes.downline_units;
  }
  const baseBaseCommission = settlementRow?.base_commission ?? 0;
  const baseRollupCommission = settlementRow?.rollup_commission ?? 0;
  const baseIncentive = settlementRow?.incentive_amount ?? 0;
  const baseTotal = settlementRow?.total_amount ?? 0;

  // override 적용된 표시값
  const personalUnitCount = pickOverride(override?.personal_unit_count, baseDirectUnits);
  const downlineUnitCount = pickOverride(override?.downline_unit_count, baseDownlineUnits);
  const personalCommission = pickOverride(override?.personal_commission, baseBaseCommission);
  const overrideAmount = pickOverride(override?.override_amount, baseRollupCommission);
  const bonusAmount = pickOverride(override?.bonus_amount, baseIncentive);

  const grossTotal = personalCommission + overrideAmount + bonusAmount;
  const withholdingTax = floorNonNegative(grossTotal * TAX_RATE);
  const netPayment = grossTotal - withholdingTax;

  return {
    yearMonth,
    labelYearMonth: label_year_month,
    dataWindow: { start_date, end_date },
    displayWindow,
    member,
    personalUnitCount,
    downlineUnitCount,
    totalUnitCount: personalUnitCount + downlineUnitCount,
    personalCommission,
    overrideAmount,
    bonusAmount,
    grossTotal,
    withholdingTax,
    netPayment,
    base: {
      direct_unit_count: baseDirectUnits,
      downline_unit_count: baseDownlineUnits,
      base_commission: baseBaseCommission,
      rollup_commission: baseRollupCommission,
      incentive_amount: baseIncentive,
      total_amount: baseTotal,
    },
    override,
  };
}

/** YYYY-MM → "YYYY년 M월" */
export function formatYearMonthKo(yearMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return yearMonth;
  return `${m[1]}년 ${parseInt(m[2], 10)}월`;
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' */
export function formatYmdDot(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return ymd.replace(/-/g, '.');
}

/** "010-1234-5678" 또는 "01012345678" → 숫자만 ("01012345678") */
export function digitsOnlyPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/\D+/g, '');
}

/**
 * 명세서 목록/엑셀 포함 여부: 선택월 지급 수당(개인수당+오버라이드+보너스)이 1원 이상일 때만.
 * 구좌만 있고 금액이 0원이면 링크·엑셀에서 제외한다.
 */
export function hasStatementPayoutAmount(args: {
  personalCommission: number;
  overrideAmount: number;
  bonusAmount: number;
}): boolean {
  const pc = Number(args.personalCommission) || 0;
  const ov = Number(args.overrideAmount) || 0;
  const bn = Number(args.bonusAmount) || 0;
  return pc + ov + bn > 0;
}

/**
 * 명세서 관리 페이지/엑셀에서 표시 자체를 차단하는 멤버 룰.
 *
 * 운영팀 요청으로 추가된 노출 차단 룰이며, 정산 계산 자체에는 영향을 주지 않는다.
 * 이름은 "[고객] " 접두어를 제거한 표시 이름 기준이고,
 * 전화번호는 하이픈 등을 제거한 11자리 숫자(`digitsOnlyPhone`) 기준이다.
 */
const SUPPRESSED_STATEMENT_SHEET_MEMBERS: Array<{ name: string; phoneDigits: string }> = [
  { name: '안성준', phoneDigits: '01079798739' },
];

export function isSuppressedStatementSheetMember(
  name: string | null | undefined,
  phone: string | null | undefined,
): boolean {
  const cleanName = (name ?? '').replace(/^\[고객\]\s*/, '').trim();
  const phoneDigits = digitsOnlyPhone(phone);
  if (!cleanName && !phoneDigits) return false;
  return SUPPRESSED_STATEMENT_SHEET_MEMBERS.some(
    (rule) => rule.name === cleanName && rule.phoneDigits === phoneDigits,
  );
}

/**
 * `/admin/settlement_sheet` 페이지/엑셀에서 영업자별 login_code 를 찾기 위한 다단계 매칭.
 *
 * 우선순위:
 *   1) user_profiles.member_id = monthly_settlements.member_id
 *   2) user_profiles.customer_id = organization_members.source_customer_id
 *   3) user_profiles.login_code  = organization_members.phone 의 끝 8자리
 *
 * 후보가 2건 이상이면 자동 매칭하지 않고 ambiguous 집합에 추가한다.
 *
 * @returns 멤버 ID → login_code (없으면 미포함) / 후보 다수 멤버 ID 집합
 */
export async function resolveLoginCodesForMembers(
  db: import('@supabase/supabase-js').SupabaseClient,
  members: Array<{ id: string; phone: string | null; source_customer_id?: string | null }>,
): Promise<{
  loginCodeByMemberId: Map<string, string>;
  ambiguousMemberIds: Set<string>;
}> {
  const loginCodeByMemberId = new Map<string, string>();
  const ambiguousMemberIds = new Set<string>();
  if (members.length === 0) return { loginCodeByMemberId, ambiguousMemberIds };
  const memberIds = members.map((m) => m.id);
  const memberById = new Map(members.map((m) => [m.id, m]));

  // 1차) member_id 매칭
  const { data: primaryRows } = await db
    .from('user_profiles')
    .select('member_id, login_code, is_active, updated_at')
    .in('member_id', memberIds)
    .not('login_code', 'is', null)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false });
  for (const p of ((primaryRows ?? []) as Array<{
    member_id: string | null;
    login_code: string | null;
  }>)) {
    if (!p.member_id || !p.login_code) continue;
    if (!loginCodeByMemberId.has(p.member_id)) {
      loginCodeByMemberId.set(p.member_id, p.login_code);
    }
  }

  // 2차) customer_id fallback
  const unresolved1 = memberIds.filter((mid) => !loginCodeByMemberId.has(mid));
  const memberIdsByCustomerId = new Map<string, string[]>();
  for (const mid of unresolved1) {
    const m = memberById.get(mid);
    const cid = m?.source_customer_id ?? null;
    if (!cid) continue;
    const arr = memberIdsByCustomerId.get(cid) ?? [];
    arr.push(mid);
    memberIdsByCustomerId.set(cid, arr);
  }
  if (memberIdsByCustomerId.size > 0) {
    const { data: byCustomer } = await db
      .from('user_profiles')
      .select('customer_id, login_code, is_active, updated_at')
      .in('customer_id', Array.from(memberIdsByCustomerId.keys()))
      .not('login_code', 'is', null)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });
    const codesByCustomerId = new Map<string, Set<string>>();
    for (const p of ((byCustomer ?? []) as Array<{
      customer_id: string | null;
      login_code: string | null;
    }>)) {
      if (!p.customer_id || !p.login_code) continue;
      const set = codesByCustomerId.get(p.customer_id) ?? new Set<string>();
      set.add(p.login_code);
      codesByCustomerId.set(p.customer_id, set);
    }
    for (const [cid, mids] of memberIdsByCustomerId.entries()) {
      const codes = codesByCustomerId.get(cid);
      if (!codes || codes.size === 0) continue;
      if (codes.size > 1) {
        for (const mid of mids) ambiguousMemberIds.add(mid);
        continue;
      }
      const onlyCode = Array.from(codes)[0];
      for (const mid of mids) {
        if (!loginCodeByMemberId.has(mid)) loginCodeByMemberId.set(mid, onlyCode);
      }
    }
  }

  // 3차) login_code = phone 끝 8자리 fallback
  const unresolved2 = memberIds.filter(
    (mid) => !loginCodeByMemberId.has(mid) && !ambiguousMemberIds.has(mid),
  );
  const memberIdsByDigits = new Map<string, string[]>();
  for (const mid of unresolved2) {
    const m = memberById.get(mid);
    const d = digitsOnlyPhone(m?.phone);
    if (d.length < 8) continue;
    const d8 = d.slice(-8);
    const arr = memberIdsByDigits.get(d8) ?? [];
    arr.push(mid);
    memberIdsByDigits.set(d8, arr);
  }
  if (memberIdsByDigits.size > 0) {
    const { data: byLoginCode } = await db
      .from('user_profiles')
      .select('login_code, is_active, updated_at')
      .in('login_code', Array.from(memberIdsByDigits.keys()))
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });
    const countsByDigits = new Map<string, number>();
    for (const p of ((byLoginCode ?? []) as Array<{ login_code: string | null }>)) {
      if (!p.login_code) continue;
      countsByDigits.set(p.login_code, (countsByDigits.get(p.login_code) ?? 0) + 1);
    }
    for (const [d8, mids] of memberIdsByDigits.entries()) {
      const cnt = countsByDigits.get(d8) ?? 0;
      if (cnt === 0) continue;
      if (cnt > 1) {
        for (const mid of mids) ambiguousMemberIds.add(mid);
        continue;
      }
      for (const mid of mids) {
        if (!loginCodeByMemberId.has(mid)) loginCodeByMemberId.set(mid, d8);
      }
    }
  }

  return { loginCodeByMemberId, ambiguousMemberIds };
}

/**
 * 명세서/엑셀 A열(전화번호)용.
 * organization_members.phone 이 비어 있어도 계정 발급 시점의 user_profiles 전화로 채운다.
 *
 * 우선순위:
 *   1) organization_members.phone
 *   2) user_profiles.phone (member_id)
 *   3) user_profiles.pre_issued_phone (member_id)
 *   4) login_code 로 찾은 user_profiles.phone / pre_issued_phone
 *   5) login_code 가 8자리면 `010` + login_code (계정 발급 시 전화 끝8자리 규칙)
 */
export async function resolveStatementPhonesByMemberId(
  db: import('@supabase/supabase-js').SupabaseClient,
  members: Array<{ id: string; phone: string | null }>,
  loginCodeByMemberId: Map<string, string>,
): Promise<Map<string, string>> {
  const phoneByMemberId = new Map<string, string>();
  if (members.length === 0) return phoneByMemberId;

  for (const m of members) {
    const d = digitsOnlyPhone(m.phone);
    if (d) phoneByMemberId.set(m.id, d);
  }

  const missingMemberIds = members.filter((m) => !phoneByMemberId.has(m.id)).map((m) => m.id);
  if (missingMemberIds.length > 0) {
    const { data: byMember } = await db
      .from('user_profiles')
      .select('member_id, phone, pre_issued_phone, is_active, updated_at')
      .in('member_id', missingMemberIds)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });
    for (const p of ((byMember ?? []) as Array<{
      member_id: string | null;
      phone: string | null;
      pre_issued_phone: string | null;
    }>)) {
      if (!p.member_id || phoneByMemberId.has(p.member_id)) continue;
      const d = digitsOnlyPhone(p.phone) || digitsOnlyPhone(p.pre_issued_phone);
      if (d) phoneByMemberId.set(p.member_id, d);
    }
  }

  const stillMissing = members.filter((m) => !phoneByMemberId.has(m.id));
  const loginCodes = [
    ...new Set(
      stillMissing
        .map((m) => (loginCodeByMemberId.get(m.id) ?? '').trim())
        .filter((c) => /^\d{8}$/.test(c)),
    ),
  ];
  if (loginCodes.length > 0) {
    const { data: byLogin } = await db
      .from('user_profiles')
      .select('login_code, phone, pre_issued_phone, is_active, updated_at')
      .in('login_code', loginCodes)
      .order('is_active', { ascending: false })
      .order('updated_at', { ascending: false });
    const phoneByLoginCode = new Map<string, string>();
    for (const p of ((byLogin ?? []) as Array<{
      login_code: string | null;
      phone: string | null;
      pre_issued_phone: string | null;
    }>)) {
      const code = (p.login_code ?? '').trim();
      if (!code || phoneByLoginCode.has(code)) continue;
      const d = digitsOnlyPhone(p.phone) || digitsOnlyPhone(p.pre_issued_phone);
      if (d) phoneByLoginCode.set(code, d);
    }
    for (const m of stillMissing) {
      const code = (loginCodeByMemberId.get(m.id) ?? '').trim();
      if (!code) continue;
      const fromProfile = phoneByLoginCode.get(code);
      if (fromProfile) {
        phoneByMemberId.set(m.id, fromProfile);
        continue;
      }
      // 계정 발급 규칙: login_code = 휴대폰 끝 8자리 → 010 + login_code
      if (/^\d{8}$/.test(code)) {
        phoneByMemberId.set(m.id, `010${code}`);
      }
    }
  }

  return phoneByMemberId;
}
