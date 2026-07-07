import type { Contract } from '@/lib/types/contract';
import type { RankType } from '@/lib/types/organization';
function monthEndDate(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export type PreIssuedCodeSettingStatus = 'active' | 'paused' | 'ended';

export type PreIssuedCodeMemberSetting = {
  id: string;
  member_id: string;
  parent_leader_member_id: string;
  reason: string;
  special_unit_price: number;
  special_unit_limit: number;
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null; // YYYY-MM-DD
  status: PreIssuedCodeSettingStatus;
  note: string | null;
  updated_at?: string | null;
};

export type PreIssuedSpecialRuntimeStatus =
  | '적용중'
  | '특례 소진'
  | '중지'
  | '종료'
  | '검토 필요';

export function isSettingActiveOnYmd(
  setting: PreIssuedCodeMemberSetting,
  ymd: string,
): boolean {
  if (setting.status !== 'active') return false;
  const from = (setting.effective_from ?? '').slice(0, 10);
  const to = setting.effective_to ? setting.effective_to.slice(0, 10) : null;
  if (!from) return false;
  if (ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

/**
 * 월정산 계산(연-월)에 대해, 해당 월 말 기준으로 "조직 예외 parent"를 적용할지 결정.
 * - 과거 재귀속 방지: effective_from 이후(포함) monthEnd에만 오버라이드 활성.
 * - daily/contract 단위까지 완전한 time-slicing 은 현재 정산 구조상 비용이 커서,
 *   운영 요구(선발급자는 보통 첫 판매 전 등록)에 맞춰 월 단위로 적용한다.
 */
export function isParentOverrideActiveForYearMonth(
  setting: PreIssuedCodeMemberSetting,
  yearMonth: string,
): boolean {
  const end = monthEndDate(yearMonth);
  return isSettingActiveOnYmd(setting, end);
}

export type SpecialSplit = {
  special_units: number;
  normal_units: number;
  special_unit_price: number;
  normal_unit_price: number;
  special_amount: number;
  normal_amount: number;
  special_units_before: number;
  special_units_after: number;
  remaining_special_units_after: number;
};

/**
 * 특례 한도는 "본인 직접판매 실제 구좌" 누계만 사용한다.
 * - 더블업/승급용 인정구좌, 산하 누적, 오버라이드 구좌는 사용 금지.
 * - 계약 단위로 잔여 특례 구좌를 초과하면 같은 계약 안에서 분할한다.
 */
export function splitDirectContractByPreIssuedSpecial(params: {
  contractUnitCount: number;
  specialConsumedBefore: number;
  setting: PreIssuedCodeMemberSetting;
  normalUnitPrice: number;
}): SpecialSplit {
  const total = Math.max(0, params.contractUnitCount);
  const limit = Math.max(0, params.setting.special_unit_limit ?? 0);
  const consumedBefore = Math.max(0, params.specialConsumedBefore);
  const remainingBefore = Math.max(0, limit - consumedBefore);
  const specialUnits = Math.min(total, remainingBefore);
  const normalUnits = Math.max(0, total - specialUnits);

  const specialUnitPrice = Math.max(0, params.setting.special_unit_price ?? 0);
  const normalUnitPrice = Math.max(0, params.normalUnitPrice ?? 0);
  const specialAmount = specialUnits * specialUnitPrice;
  const normalAmount = normalUnits * normalUnitPrice;

  const consumedAfter = Math.min(limit, consumedBefore + specialUnits);
  const remainingAfter = Math.max(0, limit - consumedAfter);

  return {
    special_units: specialUnits,
    normal_units: normalUnits,
    special_unit_price: specialUnitPrice,
    normal_unit_price: normalUnitPrice,
    special_amount: specialAmount,
    normal_amount: normalAmount,
    special_units_before: consumedBefore,
    special_units_after: consumedAfter,
    remaining_special_units_after: remainingAfter,
  };
}

export function resolvePreIssuedSpecialStatus(params: {
  setting: PreIssuedCodeMemberSetting | null;
  specialConsumedUnits: number;
  asOfYmd: string;
}): PreIssuedSpecialRuntimeStatus {
  const { setting } = params;
  if (!setting) return '실적 없음' as any; // 화면에서 setting 존재 여부로 분기
  if (setting.member_id === setting.parent_leader_member_id) return '검토 필요';
  const from = (setting.effective_from ?? '').slice(0, 10);
  if (!from) return '검토 필요';

  if (setting.status === 'paused') return '중지';
  if (setting.status === 'ended') return '종료';
  if (setting.effective_to && params.asOfYmd > setting.effective_to.slice(0, 10)) return '종료';

  const limit = Math.max(0, setting.special_unit_limit ?? 0);
  if (limit <= 0) return '특례 소진';
  return params.specialConsumedUnits >= limit ? '특례 소진' : '적용중';
}

/**
 * 특례 한도 소진용 직접판매 누계: member 자신의 "직접 계약(정산 대상)" unit_count 합.
 * - 여기서 Contract는 이미 "해당 멤버에게 직접 귀속된 정산 계약" 리스트여야 한다.
 */
export function sumActualDirectUnitsForSpecial(
  directContracts: ReadonlyArray<Pick<Contract, 'unit_count'>>,
): number {
  let sum = 0;
  for (const c of directContracts) sum += Math.max(0, c.unit_count ?? 0);
  return sum;
}

export function isSpecialApplicableToContract(params: {
  setting: PreIssuedCodeMemberSetting;
  contractOrderYmd: string;
  memberId: string;
  contractSalesMemberId: string | null;
}): boolean {
  // 직접판매만: 계약 담당자 = 본인
  if (!params.contractSalesMemberId) return false;
  if (params.contractSalesMemberId !== params.memberId) return false;
  return isSettingActiveOnYmd(params.setting, params.contractOrderYmd);
}

export function computeNormalUnitPriceForRank(params: {
  rankAtContract: RankType;
  salesUnitPrice: number;
  leaderUnitPrice: number;
  centerChiefUnitPrice: number;
}): number {
  if (params.rankAtContract === '센터장') return params.centerChiefUnitPrice;
  if (params.rankAtContract === '리더') return params.leaderUnitPrice;
  return params.salesUnitPrice;
}

