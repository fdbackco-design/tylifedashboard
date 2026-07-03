import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import { happycallYmdSeoul } from '@/lib/settlement/settlement-eligibility-v2';

/** 리더 승격/유지 판정에 쓰는 '가입' 계약만 (status === 가입, 귀속된 담당자 기준) */
export type AttributedJoinContractRow = {
  id: string;
  join_date: string; // YYYY-MM-DD
  unit_count: number;
  sales_member_id: string;
  /** 동일 순서일 tie-break 보조. invoice_registered_at 없을 때만 사용 */
  created_at?: string | null;
  /** 동일 해피콜 완료일 내 순서: 송장 등록 시각(invoice_registered_at) 우선 */
  invoice_registered_at?: string | null;
  /**
   * 정산 v2 가입 순서 1순위: 해피콜 완료 일시(서울 YMD 또는 ISO).
   * 없으면 join_date 로 fallback.
   */
  happy_call_at?: string | null;
};

/** 승격 전/후·리더 단가 분기에 쓰는 계약 참조 */
export type PromotionOrderContractRef = {
  id: string;
  join_date: string;
  happy_call_at?: string | null;
  invoice_registered_at?: string | null;
  created_at?: string | null;
};

/**
 * 산하 가입 계약을 (순서일 → 송장등록시각 → created_at → id) 순으로 쌓을 때,
 * 누적 구좌가 처음 20 이상이 되는 그 계약(승격 계약).
 * 순서일은 해피콜 완료일(서울 YMD) 우선, 없으면 join_date.
 */
export type SalesMemberPromotionThreshold = {
  threshold_contract_id: string;
  /** 승격 계약의 순서일(해피콜 완료 YMD 우선, 없으면 join_date). 컬럼명은 레거시 유지 */
  threshold_join_date: string;
  /** 승격 계약의 invoice_registered_at (동일 순서일 tie-break 1순위) */
  threshold_invoice_registered_at?: string | null;
  /** 승격 계약의 created_at(동일 순서일 tie-break 보조) */
  threshold_created_at?: string | null;
  /**
   * 승격 계약 내 20구좌 달성에 포함되는 구좌 수(승격 전·승격 계약 본체).
   * 나머지(unit_count - 본 값)는 동일 계약 내 승격 후 구좌로 본다.
   */
  threshold_pre_promotion_units_on_contract?: number;
};

function normalizeCreatedAt(s?: string | null): string {
  if (s == null) return '';
  return String(s).trim();
}

/** 정산 수당·승격 순서 판정용 기준일: 해피콜 완료일(서울 YMD) 우선, 없으면 join_date */
export function contractJoinOrderYmd(c: {
  join_date: string;
  happy_call_at?: string | null;
}): string {
  const hc = happycallYmdSeoul(c.happy_call_at);
  if (hc) return hc;
  return String(c.join_date ?? '').slice(0, 10);
}

/** 동일 순서일 tie-break: invoice_registered_at → created_at → id */
export function promotionOrderTieBreakTs(c: {
  invoice_registered_at?: string | null;
  created_at?: string | null;
}): string {
  const inv = normalizeCreatedAt(c.invoice_registered_at);
  if (inv) return inv;
  return normalizeCreatedAt(c.created_at);
}

function compareSameOrderDayOrder(contract: PromotionOrderContractRef, th: SalesMemberPromotionThreshold): number {
  const cTie = promotionOrderTieBreakTs(contract);
  const tTie =
    promotionOrderTieBreakTs({
      invoice_registered_at: th.threshold_invoice_registered_at,
      created_at: th.threshold_created_at,
    }) || normalizeCreatedAt(th.threshold_created_at);
  if (cTie !== '' && tTie !== '') {
    const d = cTie.localeCompare(tTie);
    if (d !== 0) return d;
  }
  return contract.id.localeCompare(th.threshold_contract_id);
}

/**
 * 계약 c가 승격 계약 이후(동일 순서일이면 id가 승격 계약 id 이상)인지.
 * 이때부터 직급 단가를 리더(40만)로 본다.
 * 순서일은 해피콜 완료일 우선.
 */
export function isContractAtOrAfterPromotionThreshold(
  contract: PromotionOrderContractRef,
  threshold: SalesMemberPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  const aj = contractJoinOrderYmd(contract);
  const tj = threshold.threshold_join_date;
  if (aj > tj) return true;
  if (aj < tj) return false;
  return compareSameOrderDayOrder(contract, threshold) >= 0;
}

/**
 * 계약 c가 승격 계약 "다음" 계약부터(엄밀히 after) 리더 단가를 적용해야 하는 경우에 사용.
 * - 승격 계약 자체(threshold_contract_id)는 승격 전(영업사원 단가)으로 본다.
 * 순서일은 해피콜 완료일 우선.
 */
export function isContractStrictlyAfterPromotionThreshold(
  contract: PromotionOrderContractRef,
  threshold: SalesMemberPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  const aj = contractJoinOrderYmd(contract);
  const tj = threshold.threshold_join_date;
  if (aj > tj) return true;
  if (aj < tj) return false;
  return compareSameOrderDayOrder(contract, threshold) > 0;
}

/**
 * 승격 경계를 걸치는 계약(예: 4구좌 중 18→20 달성)을 승격 전/후 구좌로 분할.
 */
export function splitContractUnitsByPromotionThreshold(
  contract: PromotionOrderContractRef & { unit_count: number },
  threshold: SalesMemberPromotionThreshold | null,
): { prePromotionUnits: number; postPromotionUnits: number } {
  const total = Math.max(0, contract.unit_count ?? 0);
  if (!threshold || total === 0) {
    return { prePromotionUnits: total, postPromotionUnits: 0 };
  }

  const aj = contractJoinOrderYmd(contract);
  const tj = threshold.threshold_join_date;
  if (aj < tj) return { prePromotionUnits: total, postPromotionUnits: 0 };
  if (aj > tj) return { prePromotionUnits: 0, postPromotionUnits: total };

  const cmp = compareSameOrderDayOrder(contract, threshold);
  if (cmp < 0) return { prePromotionUnits: total, postPromotionUnits: 0 };
  if (cmp > 0) return { prePromotionUnits: 0, postPromotionUnits: total };

  if (contract.id !== threshold.threshold_contract_id) {
    return { prePromotionUnits: total, postPromotionUnits: 0 };
  }

  const preOnContract = Math.min(
    total,
    Math.max(0, threshold.threshold_pre_promotion_units_on_contract ?? total),
  );
  return {
    prePromotionUnits: preOnContract,
    postPromotionUnits: total - preOnContract,
  };
}

/** 상위 노드 롤업에 포함할 구좌: 본인 승격 후 + (자식 승격자면) 자식 승격 전 */
export function rollupEligibleUnitsForParentSubtree(
  contract: PromotionOrderContractRef & { unit_count: number },
  nodeThreshold: SalesMemberPromotionThreshold | null,
  childThreshold: SalesMemberPromotionThreshold | null,
): number {
  let units = contract.unit_count;
  if (nodeThreshold) {
    units = splitContractUnitsByPromotionThreshold(contract, nodeThreshold).postPromotionUnits;
  }
  if (childThreshold) {
    const preChild = splitContractUnitsByPromotionThreshold(contract, childThreshold).prePromotionUnits;
    units = Math.min(units, preChild);
  }
  return units;
}

/** 승격자의 이전 리더 보강 롤업에 포함할 구좌(승격 전만) */
export function prePromotionUnitsForPreviousLeaderRollup(
  contract: PromotionOrderContractRef & { unit_count: number },
  promotedThreshold: SalesMemberPromotionThreshold,
): number {
  return splitContractUnitsByPromotionThreshold(contract, promotedThreshold).prePromotionUnits;
}

function compareAttributedJoinRows(a: AttributedJoinContractRow, b: AttributedJoinContractRow): number {
  const od = contractJoinOrderYmd(a).localeCompare(contractJoinOrderYmd(b));
  if (od !== 0) return od;
  const ta = promotionOrderTieBreakTs(a);
  const tb = promotionOrderTieBreakTs(b);
  if (ta !== '' && tb !== '') {
    const t = ta.localeCompare(tb);
    if (t !== 0) return t;
  }
  const ca = normalizeCreatedAt(a.created_at);
  const cb = normalizeCreatedAt(b.created_at);
  if (ca !== '' && cb !== '') {
    const t = ca.localeCompare(cb);
    if (t !== 0) return t;
  }
  return a.id.localeCompare(b.id);
}

/**
 * 영업사원별: 본인 산하 '가입' 누적 구좌가 20 이상이 되는 순간의 **승격 계약**(날짜만이 아니라 계약 단위).
 */
export function computeSalesMemberPromotionThreshold(
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  rankById: Map<string, RankType>,
): Map<string, SalesMemberPromotionThreshold | null> {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);

  const out = new Map<string, SalesMemberPromotionThreshold | null>();
  for (const [id, rank] of rankById) {
    if (rank !== '영업사원') continue;
    const subtree = collectSubtreeMemberIdsDownstream(id, childrenByParent);
    out.set(id, computeThresholdForSubtree(subtree, sorted, LEADER_PROMOTION_MIN_UNITS));
  }
  return out;
}

/**
 * `leader_promotion_events`에 기록된 승격 계약을 threshold 맵의 단일 출처(SSOT)로 덮어쓴다.
 * 월정산·조직 KPI에서 `joinAttributed` 귀속 차이로 재계산된 threshold가 이벤트와 어긋나는 것을 맞춘다.
 */
export function mergeLeaderPromotionEventThresholds(
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  events: ReadonlyArray<{
    member_id?: string | null;
    threshold_contract_id?: string | null;
    threshold_join_date?: string | null;
  }>,
  thresholdContractMetaById: ReadonlyMap<
    string,
    {
      join_date: string;
      happy_call_at?: string | null;
      invoice_registered_at?: string | null;
      created_at?: string | null;
    }
  >,
): void {
  for (const r of events) {
    if (!r?.member_id || !r.threshold_contract_id || !r.threshold_join_date) continue;
    const cid = String(r.threshold_contract_id);
    const meta = thresholdContractMetaById.get(cid);
    promotionThresholdByMemberId.set(String(r.member_id), {
      threshold_contract_id: cid,
      threshold_join_date: meta
        ? contractJoinOrderYmd(meta)
        : String(r.threshold_join_date).slice(0, 10),
      threshold_invoice_registered_at: meta?.invoice_registered_at ?? null,
      threshold_created_at: meta?.created_at ?? null,
    });
  }
}

/** @deprecated 날짜만으로는 같은 일자 계약을 구분할 수 없음 — computeSalesMemberPromotionThreshold 사용 */
export function computeSalesMemberPromotionFirstJoinDate(
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  rankById: Map<string, RankType>,
): Map<string, string | null> {
  const th = computeSalesMemberPromotionThreshold(treeRows, joinContractsAttributed, rankById);
  const out = new Map<string, string | null>();
  for (const [k, v] of th) {
    out.set(k, v?.threshold_join_date ?? null);
  }
  return out;
}

/** 정산월 말(25일) 시점까지 누적된 산하 '가입' 구좌 합 (해당 일자 포함) */
export function subtreeJoinUnitsJoinOnlyAsOf(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  asOfInclusive: string,
): number {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const cap = asOfInclusive.slice(0, 10);
  let sum = 0;
  for (const c of joinContractsAttributed) {
    if (!subtree.has(c.sales_member_id)) continue;
    const jd = c.join_date.slice(0, 10);
    if (jd <= cap) sum += Math.max(0, c.unit_count ?? 0);
  }
  return sum;
}

/** 정산 윈도우(start~end) 내 산하 '가입' 구좌 합 (둘 다 포함) */
export function subtreeJoinUnitsJoinOnlyInWindow(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  joinContractsAttributed: AttributedJoinContractRow[];
  startInclusive: string;
  endInclusive: string;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(params.memberId, childrenByParent);
  const start = params.startInclusive.slice(0, 10);
  const end = params.endInclusive.slice(0, 10);
  let sum = 0;
  for (const c of params.joinContractsAttributed) {
    if (!subtree.has(c.sales_member_id)) continue;
    const jd = c.join_date.slice(0, 10);
    if (jd < start || jd > end) continue;
    sum += Math.max(0, c.unit_count ?? 0);
  }
  return sum;
}

/**
 * 유지장려금(100만원) 정산월 구간 판정용 기준일 — 해피콜 완료일(서울 YMD).
 * 해피콜 일시가 없으면 집계에서 제외한다.
 */
function leaderMaintenancePeriodYmd(c: AttributedJoinContractRow): string | null {
  const ymd = happycallYmdSeoul(c.happy_call_at);
  return ymd || null;
}

/**
 * 루트 멤버를 포함한 subtree를 모으되, 자식 중 "리더 이상" 직급(리더/센터장/사업본부장/본사)
 * 노드는 그 노드와 그 후손을 모두 제외한다.
 *
 * 유지장려금 집계 전용 — 하위 리더 조직의 구좌가 상위 리더의 유지장려금에 합산되지 않도록 한다.
 * (롤업수당 등 다른 계산은 기존 `collectSubtreeMemberIdsDownstream`을 그대로 사용한다.)
 */
function collectSubtreeMemberIdsExcludingDownLeaders(
  rootId: string,
  childrenByParent: Map<string, string[]>,
  rankById: Map<string, RankType>,
): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const ch of childrenByParent.get(id) ?? []) {
      const r = rankById.get(ch);
      // 자식 노드가 리더 이상이면, 그 노드와 그 후손은 유지장려금 집계에서 제외
      if (r === '리더' || r === '센터장' || r === '사업본부장' || r === '본사') continue;
      stack.push(ch);
    }
  }
  return out;
}

/**
 * 정산월 해피콜 윈도우(start~end) 내 산하 '가입' 구좌 합 — **유지장려금 전용**.
 *
 * 기준일은 join_date 가 아니라 happy_call_at(서울 YMD)이다.
 * 윈도우 경계는 정산 v2 `getHappycallWindowForYearMonth` 와 동일하게 호출 측에서 넘긴다.
 *
 * `subtreeJoinUnitsJoinOnlyInWindow`와 동일한 subtree 컷 규칙(하위 리더 제외)을 적용한다.
 * 자식 중 리더 이상 직급 노드를 만나면 해당 노드와 그 후손을 모두 컷한다.
 *
 * 예) 리더 A 산하에 리더 B → 영업사원 C(10구좌)가 있을 때:
 *  - A 호출: 10구좌가 합산되지 않는다(B부터 컷).
 *  - B 호출: 자기 자신의 subtree(B + C)에서 10구좌가 합산된다.
 */
export function subtreeJoinUnitsForLeaderMaintenanceInWindow(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  joinContractsAttributed: AttributedJoinContractRow[];
  startInclusive: string;
  endInclusive: string;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const rankById = new Map<string, RankType>();
  for (const r of params.treeRows) rankById.set(r.id, r.rank);

  const subtree = collectSubtreeMemberIdsExcludingDownLeaders(
    params.memberId,
    childrenByParent,
    rankById,
  );
  const start = params.startInclusive.slice(0, 10);
  const end = params.endInclusive.slice(0, 10);
  let sum = 0;
  for (const c of params.joinContractsAttributed) {
    if (!subtree.has(c.sales_member_id)) continue;
    const periodYmd = leaderMaintenancePeriodYmd(c);
    if (!periodYmd || periodYmd < start || periodYmd > end) continue;
    sum += Math.max(0, c.unit_count ?? 0);
  }
  return sum;
}

export function isLeaderMaintenanceBonusEligible(params: {
  memberDbRank: RankType;
  promotionThreshold: SalesMemberPromotionThreshold | null;
  subtreeJoinUnitsAsOf25: number;
}): boolean {
  if (params.memberDbRank !== '영업사원') return false;
  if (!params.promotionThreshold) return false;
  return params.subtreeJoinUnitsAsOf25 >= 20;
}

/** 센터장 승격: 산하 리더 최소 인원 */
export const CENTER_CHIEF_PROMOTION_MIN_LEADERS = 5;

/** 리더 정책 승격: 산하 가입 누적 구좌 최소 */
export const LEADER_PROMOTION_MIN_UNITS = 20;

/** `external_id = customer:{uuid}` 가상 노드(본인 고객 귀속용). 20구좌 승격 대상에서 제외 */
export function isCustomerVirtualOrgMember(externalId: string | null | undefined): boolean {
  return String(externalId ?? '').trim().startsWith('customer:');
}

/** DB 승격 반영 대상: 영업사원이면서 customer 가상 노드가 아닌 경우만 */
export function isLeaderPromotionEligibleMember(params: {
  rank: RankType;
  externalId?: string | null;
}): boolean {
  if (params.rank !== '영업사원') return false;
  if (isCustomerVirtualOrgMember(params.externalId)) return false;
  return true;
}

function computeThresholdForSubtree(
  subtree: Set<string>,
  sorted: AttributedJoinContractRow[],
  minUnits: number,
): SalesMemberPromotionThreshold | null {
  let cum = 0;
  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const units = Math.max(0, c.unit_count ?? 0);
    const cumBefore = cum;
    cum += units;
    if (cum >= minUnits) {
      return {
        threshold_contract_id: c.id,
        threshold_join_date: contractJoinOrderYmd(c),
        threshold_invoice_registered_at: c.invoice_registered_at ?? null,
        threshold_created_at: c.created_at ?? null,
        threshold_pre_promotion_units_on_contract: minUnits - cumBefore,
      };
    }
  }
  return null;
}

/** 정책 승격자(이미 DB 리더 포함) 산하 20구좌 승격 계약 — joinAttributed 정렬 기준과 동일 */
export function computePromotionThresholdForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
): SalesMemberPromotionThreshold | null {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  return computeThresholdForSubtree(subtree, sorted, minUnits);
}

/**
 * DB 승격·leader_promotion_events 기록용 threshold.
 *
 * `computeSalesMemberPromotionThreshold` 와 달리:
 * - DB rank 가 **영업사원** 인 멤버만 대상 (이미 리더인 사람 재계산/백필 없음)
 * - `customer:*` 가상 노드 제외
 * - 승격 계약의 귀속 `sales_member_id` 가 해당 멤버 subtree 에 포함되는 경우만 허용
 */
export function computeLeaderPromotionThresholds(
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  members: ReadonlyArray<{ id: string; rank: RankType; external_id?: string | null }>,
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
): Map<string, SalesMemberPromotionThreshold | null> {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const out = new Map<string, SalesMemberPromotionThreshold | null>();

  for (const m of members) {
    if (!isLeaderPromotionEligibleMember({ rank: m.rank, externalId: m.external_id })) {
      continue;
    }
    const subtree = collectSubtreeMemberIdsDownstream(m.id, childrenByParent);
    const promo = computeThresholdForSubtree(subtree, sorted, minUnits);
    if (!promo) {
      out.set(m.id, null);
      continue;
    }
    const thRow = joinContractsAttributed.find((c) => c.id === promo.threshold_contract_id);
    if (!thRow || !subtree.has(thRow.sales_member_id)) {
      out.set(m.id, null);
      continue;
    }
    out.set(m.id, promo);
  }
  return out;
}

/**
 * 산하(본인 제외)에 rank가 '리더'인 멤버가 CENTER_CHIEF_PROMOTION_MIN_LEADERS 이상이면
 * 해당 멤버(현재 직급이 리더인 경우)를 센터장으로 승격 대상으로 본다.
 *
 * `externalIdByMemberId`가 주어지면 `customer:*` 가상 노드는 산하 리더 수에 포함하지 않는다.
 */
export function computeCenterChiefPromotionMemberIds(
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): string[] {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const out: string[] = [];

  const countsAsSubtreeLeader = (memberId: string): boolean => {
    if (rankById.get(memberId) !== '리더') return false;
    if (externalIdByMemberId && isCustomerVirtualOrgMember(externalIdByMemberId.get(memberId))) {
      return false;
    }
    return true;
  };

  for (const [memberId, rank] of rankById) {
    if (rank !== '리더') continue;

    const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
    let leaderCount = 0;
    for (const sid of subtree) {
      if (sid === memberId) continue;
      if (countsAsSubtreeLeader(sid)) leaderCount++;
    }
    if (leaderCount >= CENTER_CHIEF_PROMOTION_MIN_LEADERS) {
      out.push(memberId);
    }
  }

  return out;
}

/**
 * 산하 유효 리더가 CENTER_CHIEF_PROMOTION_MIN_LEADERS 미만인 센터장 → 리더 강등 대상.
 * (잘못된 리더 승격 보정 후 센터장 조건이 깨진 경우 등)
 */
export function computeCenterChiefDemotionMemberIds(
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): string[] {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const out: string[] = [];

  const countsAsSubtreeLeader = (memberId: string): boolean => {
    if (rankById.get(memberId) !== '리더') return false;
    if (externalIdByMemberId && isCustomerVirtualOrgMember(externalIdByMemberId.get(memberId))) {
      return false;
    }
    return true;
  };

  for (const [memberId, rank] of rankById) {
    if (rank !== '센터장') continue;

    const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
    let leaderCount = 0;
    for (const sid of subtree) {
      if (sid === memberId) continue;
      if (countsAsSubtreeLeader(sid)) leaderCount++;
    }
    if (leaderCount < CENTER_CHIEF_PROMOTION_MIN_LEADERS) {
      out.push(memberId);
    }
  }

  return out;
}
