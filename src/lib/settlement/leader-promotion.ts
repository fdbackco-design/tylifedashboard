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

/** 동일 송장 배치 등 ms 차이만 나는 invoice_registered_at 은 초 단위로 묶는다. */
function invoiceRegisteredAtSecondKey(s?: string | null): string {
  const inv = normalizeCreatedAt(s);
  if (!inv) return '';
  const dot = inv.indexOf('.');
  if (dot > 0) return inv.slice(0, dot);
  if (inv.length >= 19) return inv.slice(0, 19);
  return inv;
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

/** 동일 순서일 tie-break: invoice_registered_at(초) → created_at → id */
export function promotionOrderTieBreakTs(c: {
  invoice_registered_at?: string | null;
  created_at?: string | null;
}): string {
  const invSec = invoiceRegisteredAtSecondKey(c.invoice_registered_at);
  if (invSec) return invSec;
  return normalizeCreatedAt(c.created_at);
}

/**
 * 동일 순서일(해피콜 완료일) 내 정렬.
 * - 송장 등록 시각이 있는 계약이 없는 계약보다 앞선다.
 * - 둘 다 있으면 invoice_registered_at 을 초 단위로 비교(동일 송장 배치 ms 차이는 created_at 으로).
 * - 없으면 created_at.
 */
function comparePromotionOrderTieBreak(
  a: { invoice_registered_at?: string | null; created_at?: string | null },
  b: { invoice_registered_at?: string | null; created_at?: string | null },
): number {
  const secA = invoiceRegisteredAtSecondKey(a.invoice_registered_at);
  const secB = invoiceRegisteredAtSecondKey(b.invoice_registered_at);
  if (secA && secB) {
    const d = secA.localeCompare(secB);
    if (d !== 0) return d;
    const ca = normalizeCreatedAt(a.created_at);
    const cb = normalizeCreatedAt(b.created_at);
    if (ca !== cb) return ca.localeCompare(cb);
    return 0;
  }
  if (secA && !secB) return -1;
  if (!secA && secB) return 1;
  const ca = normalizeCreatedAt(a.created_at);
  const cb = normalizeCreatedAt(b.created_at);
  if (ca !== cb) return ca.localeCompare(cb);
  return 0;
}

function compareSameOrderDayOrder(contract: PromotionOrderContractRef, th: SalesMemberPromotionThreshold): number {
  const tie = comparePromotionOrderTieBreak(contract, {
    invoice_registered_at: th.threshold_invoice_registered_at,
    created_at: th.threshold_created_at,
  });
  if (tie !== 0) return tie;
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
  contract: PromotionOrderContractRef & { unit_count?: number },
  threshold: SalesMemberPromotionThreshold | null,
  walkSplitByContractId?: Map<string, PromotionUnitSplit> | null,
): boolean {
  if (!threshold) return false;
  const total = Math.max(0, contract.unit_count ?? 0);
  const units = total > 0 ? total : 1;
  const split = resolvePromotionUnitSplit(
    { ...contract, unit_count: units },
    threshold,
    walkSplitByContractId,
  );
  return split.postPromotionUnits > 0 && split.prePromotionUnits === 0;
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

  // 승격 계약 본체는 승격 전 단가. enrich가 joinAttributed 누적 차이로 0을 넣는 경우 전량 승격 전.
  const explicitPre = threshold.threshold_pre_promotion_units_on_contract;
  const preOnContract =
    explicitPre != null && explicitPre > 0
      ? Math.min(total, explicitPre)
      : total;
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
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>,
  nodeMemberId?: string,
  childMemberId?: string,
): number {
  let units = contract.unit_count;
  if (nodeThreshold) {
    const nodeWalk = nodeMemberId ? promotionUnitSplitByMemberId?.get(nodeMemberId) : undefined;
    units = resolvePromotionUnitSplit(contract, nodeThreshold, nodeWalk).postPromotionUnits;
  }
  if (childThreshold) {
    const childWalk = childMemberId ? promotionUnitSplitByMemberId?.get(childMemberId) : undefined;
    const preChild = resolvePromotionUnitSplit(contract, childThreshold, childWalk).prePromotionUnits;
    units = Math.min(units, preChild);
  }
  return units;
}

/** 승격자의 이전 리더 보강 롤업에 포함할 구좌(승격 전만) */
export function prePromotionUnitsForPreviousLeaderRollup(
  contract: PromotionOrderContractRef & { unit_count: number },
  promotedThreshold: SalesMemberPromotionThreshold,
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>,
  promotedMemberId?: string,
): number {
  const walk = promotedMemberId ? promotionUnitSplitByMemberId?.get(promotedMemberId) : undefined;
  return resolvePromotionUnitSplit(contract, promotedThreshold, walk).prePromotionUnits;
}

function compareAttributedJoinRows(a: AttributedJoinContractRow, b: AttributedJoinContractRow): number {
  const od = contractJoinOrderYmd(a).localeCompare(contractJoinOrderYmd(b));
  if (od !== 0) return od;
  const tie = comparePromotionOrderTieBreak(a, b);
  if (tie !== 0) return tie;
  return a.id.localeCompare(b.id);
}

/** 리더 승격 20구좌 누적에 포함되는 계약인지 (status === 가입 만) */
export function isLeaderPromotionJoinContractRow(row: {
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
}): boolean {
  if (row.is_cancelled) return false;
  if (String(row.status ?? '').trim() !== '가입') return false;
  if (!row.sales_member_id) return false;
  if ((row.sales_link_status ?? 'linked') !== 'linked') return false;
  return true;
}

/** SETTLEMENT_DEBUG: 멤버 산하 20구좌 달성 경로(누적 순) */
export function debugPromotionThresholdPath(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnits: number = 20,
): Array<{
  contract_id: string;
  order_ymd: string;
  invoice_registered_at: string | null;
  unit_count: number;
  cum_before: number;
  cum_after: number;
  is_threshold: boolean;
}> {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const out: Array<{
    contract_id: string;
    order_ymd: string;
    invoice_registered_at: string | null;
    unit_count: number;
    cum_before: number;
    cum_after: number;
    is_threshold: boolean;
  }> = [];
  let cum = 0;
  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const units = Math.max(0, c.unit_count ?? 0);
    const cumBefore = cum;
    cum += units;
    out.push({
      contract_id: c.id,
      order_ymd: contractJoinOrderYmd(c),
      invoice_registered_at: c.invoice_registered_at ?? null,
      unit_count: units,
      cum_before: cumBefore,
      cum_after: cum,
      is_threshold: cum >= minUnits && cumBefore < minUnits,
    });
    if (cum >= minUnits) break;
  }
  return out;
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
 * 이벤트 테이블 등에서 threshold_contract_id만 알 때 승격 계약 내 pre 구좌 수를 보강한다.
 */
export type PromotionUnitSplit = {
  prePromotionUnits: number;
  postPromotionUnits: number;
};

function prePromotionUnitsOnThresholdContract(
  units: number,
  cumBeforeThreshold: number,
  minUnits: number,
): number {
  const preOnContract = minUnits - cumBeforeThreshold;
  if (preOnContract > 0) return Math.min(units, preOnContract);
  // joinAttributed가 이벤트 시점보다 많아 누적이 이미 20 이상인 경우, 승격 계약 본체는 전량 승격 전
  return units;
}

export function enrichThresholdPrePromotionUnits(
  threshold: SalesMemberPromotionThreshold,
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
): SalesMemberPromotionThreshold {
  const existingPre = threshold.threshold_pre_promotion_units_on_contract;
  if (existingPre != null && existingPre > 0) return threshold;

  const recomputed = computePromotionThresholdForMember(
    memberId,
    treeRows,
    joinContractsAttributed,
    minUnits,
  );
  if (
    recomputed &&
    recomputed.threshold_contract_id === threshold.threshold_contract_id &&
    recomputed.threshold_pre_promotion_units_on_contract != null &&
    recomputed.threshold_pre_promotion_units_on_contract > 0
  ) {
    return {
      ...threshold,
      threshold_pre_promotion_units_on_contract: recomputed.threshold_pre_promotion_units_on_contract,
    };
  }

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  let cum = 0;
  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const units = Math.max(0, c.unit_count ?? 0);
    if (c.id === threshold.threshold_contract_id) {
      return {
        ...threshold,
        threshold_pre_promotion_units_on_contract: prePromotionUnitsOnThresholdContract(
          units,
          cum,
          minUnits,
        ),
      };
    }
    cum += units;
  }
  return threshold;
}

/**
 * joinAttributed 정렬·누적 walk 기준으로 계약별 승격 전/후 구좌를 산출한다.
 * 정책 승격 이벤트의 threshold_contract_id(SSOT)까지는 전부 승격 전(30만), 이후만 승격 후(40만).
 * 날짜만 비교하면 같은 승급일·동일 송장 배치 계약이 잘못 40만원이 되는 문제를 방지한다.
 */
export function buildPromotionUnitSplitByContractId(
  memberId: string,
  threshold: SalesMemberPromotionThreshold,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
): Map<string, PromotionUnitSplit> {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const out = new Map<string, PromotionUnitSplit>();

  let cum = 0;
  let pastThreshold = false;

  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const units = Math.max(0, c.unit_count ?? 0);
    if (units === 0) continue;

    if (pastThreshold) {
      out.set(c.id, { prePromotionUnits: 0, postPromotionUnits: units });
      continue;
    }

    if (c.id === threshold.threshold_contract_id) {
      const pre = prePromotionUnitsOnThresholdContract(units, cum, minUnits);
      out.set(c.id, {
        prePromotionUnits: pre,
        postPromotionUnits: units - pre,
      });
      cum += units;
      pastThreshold = true;
      continue;
    }

    out.set(c.id, { prePromotionUnits: units, postPromotionUnits: 0 });
    cum += units;
  }

  return out;
}

/** threshold가 있는 멤버별 walk split 맵 일괄 생성 */
export function buildPromotionUnitSplitByMemberId(
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
): Map<string, Map<string, PromotionUnitSplit>> {
  const out = new Map<string, Map<string, PromotionUnitSplit>>();
  for (const [memberId, threshold] of promotionThresholdByMemberId) {
    if (!threshold) continue;
    out.set(
      memberId,
      buildPromotionUnitSplitByContractId(memberId, threshold, treeRows, joinContractsAttributed),
    );
  }
  return out;
}

/** walk 맵이 있으면 우선 사용, 없으면 날짜·tie-break 기반 split 으로 fallback */
export function resolvePromotionUnitSplit(
  contract: PromotionOrderContractRef & { unit_count: number },
  threshold: SalesMemberPromotionThreshold | null,
  walkSplitByContractId?: Map<string, PromotionUnitSplit> | null,
): PromotionUnitSplit {
  const total = Math.max(0, contract.unit_count ?? 0);
  if (!threshold || total === 0) {
    return { prePromotionUnits: total, postPromotionUnits: 0 };
  }
  const fromWalk = walkSplitByContractId?.get(contract.id);
  if (fromWalk && fromWalk.prePromotionUnits + fromWalk.postPromotionUnits === total) {
    return fromWalk;
  }
  return splitContractUnitsByPromotionThreshold(contract, threshold);
}

/**
 * joinAttributed 기준 승격 threshold 재계산·보강.
 * DB 리더는 computeLeaderPromotionThresholds 대상이 아니므로 별도 refresh가 필요하다.
 */
export function refreshPromotionThresholdsFromJoinAttributed(
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  memberIds: Iterable<string>,
): void {
  const refreshIds = new Set(memberIds);
  if (refreshIds.size === 0) return;

  const sortedJoin = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const childrenByParent = buildChildrenByParentFromRows(treeRows);

  for (const mid of refreshIds) {
    const subtree = collectSubtreeMemberIdsDownstream(mid, childrenByParent);
    const recomputed = computeThresholdForSubtree(subtree, sortedJoin, LEADER_PROMOTION_MIN_UNITS);
    if (recomputed) {
      promotionThresholdByMemberId.set(mid, recomputed);
      continue;
    }
    const existing = promotionThresholdByMemberId.get(mid);
    if (existing) {
      promotionThresholdByMemberId.set(
        mid,
        enrichThresholdPrePromotionUnits(existing, mid, treeRows, sortedJoin),
      );
    }
  }

  for (const mid of refreshIds) {
    const th = promotionThresholdByMemberId.get(mid);
    if (!th || th.threshold_pre_promotion_units_on_contract != null) continue;
    promotionThresholdByMemberId.set(
      mid,
      enrichThresholdPrePromotionUnits(th, mid, treeRows, sortedJoin),
    );
  }
}

/**
 * DB 승격·leader_promotion_events 기록용 threshold.
 *
 * `computeSalesMemberPromotionThreshold` 와 달리:
 * - DB rank 가 **영업사원** 또는 **리더** 인 멤버 대상 (customer 가상 노드 제외)
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
    if (isCustomerVirtualOrgMember(m.external_id)) continue;
    if (m.rank !== '영업사원' && m.rank !== '리더') continue;
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
