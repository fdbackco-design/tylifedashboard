import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import {
  happycallYmdSeoul,
  SETTLEMENT_VALID_HAPPYCALL_RESULTS,
} from '@/lib/settlement/settlement-eligibility-v2';
import { hasJoinSatisfyingInvoiceNo } from '@/lib/utils/invoice-no';
import {
  buildDoubleUpPromotionAudit,
  promotionEligibleUnitsForContract,
} from '@/lib/settlement/double-up-promotion';

export {
  buildDoubleUpPromotionAudit,
  DOUBLE_UP_COMMISSION_NOTE,
  DOUBLE_UP_PROMOTION_APPLIED_REASON,
  DOUBLE_UP_PROMOTION_END_YMD,
  DOUBLE_UP_PROMOTION_NAME,
  DOUBLE_UP_PROMOTION_START_YMD,
  isDoubleUpPromotionWindow,
  isHappyCallSuccessForPromotion,
  promotionEligibleUnitsForContract,
  promotionMultiplierForContract,
} from '@/lib/settlement/double-up-promotion';
export type {
  DoubleUpPromotionAudit,
  PromotionMultiplier,
} from '@/lib/settlement/double-up-promotion';

/** 리더 승격/유지 판정에 쓰는 '가입' 계약만 (status === 가입, 귀속된 담당자 기준) */
export type AttributedJoinContractRow = {
  id: string;
  join_date: string; // YYYY-MM-DD
  unit_count: number;
  sales_member_id: string;
  contract_code?: string | null;
  status?: string | null;
  created_at?: string | null;
  invoice_registered_at?: string | null;
  happy_call_at?: string | null;
  happycall_result?: string | null;
  invoice_no?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
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
 * 동일 happy_call_at 내 정렬: invoice_registered_at → created_at → (호출부에서 id)
 */
function comparePromotionOrderTieBreak(
  a: { invoice_registered_at?: string | null; created_at?: string | null },
  b: { invoice_registered_at?: string | null; created_at?: string | null },
): number {
  const invA = normalizeCreatedAt(a.invoice_registered_at);
  const invB = normalizeCreatedAt(b.invoice_registered_at);
  if (invA !== invB) {
    if (!invA) return 1;
    if (!invB) return -1;
    return invA.localeCompare(invB);
  }
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
  _threshold: SalesMemberPromotionThreshold | null,
  walkSplitByContractId?: Map<string, PromotionUnitSplit> | null,
): boolean {
  if (!walkSplitByContractId) return false;
  const total = Math.max(0, contract.unit_count ?? 0);
  const units = total > 0 ? total : 1;
  const split = resolvePromotionUnitSplit(
    { ...contract, unit_count: units },
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
  const nodeWalk = nodeMemberId ? promotionUnitSplitByMemberId?.get(nodeMemberId) : undefined;
  const childWalk = childMemberId ? promotionUnitSplitByMemberId?.get(childMemberId) : undefined;
  if (nodeWalk) {
    units = resolvePromotionUnitSplit(contract, nodeWalk).postPromotionUnits;
  }
  if (childWalk) {
    const preChild = resolvePromotionUnitSplit(contract, childWalk).prePromotionUnits;
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
  return resolvePromotionUnitSplit(contract, walk).prePromotionUnits;
}

/** 승격 누적 walk 정렬: happy_call_at → invoice_registered_at → created_at → id */
export function comparePromotionAccumulationRows(
  a: AttributedJoinContractRow,
  b: AttributedJoinContractRow,
): number {
  const ha = normalizeCreatedAt(a.happy_call_at);
  const hb = normalizeCreatedAt(b.happy_call_at);
  if (ha !== hb) {
    if (!ha) return 1;
    if (!hb) return -1;
    return ha.localeCompare(hb);
  }
  const tie = comparePromotionOrderTieBreak(a, b);
  if (tie !== 0) return tie;
  return a.id.localeCompare(b.id);
}

function compareAttributedJoinRows(a: AttributedJoinContractRow, b: AttributedJoinContractRow): number {
  return comparePromotionAccumulationRows(a, b);
}

/** 가입(status=가입) 계약 누적 walk — 수당 판정 SSOT
 *
 * - 승급 경계(20구좌): 더블업 인정구좌 누적
 * - 수당 수량(pre/post): 실제 unit_count
 * - 승급 계약(경계를 넘긴 계약) 자체는 영업사원 단가, 그 다음 계약부터 리더 단가
 */
function promotionWalkFromCumulative(
  sorted: AttributedJoinContractRow[],
  subtree: Set<string>,
  minUnits: number,
): { splitByContractId: Map<string, PromotionUnitSplit>; audit: PromotionCommissionSplit[] } {
  const splitByContractId = new Map<string, PromotionUnitSplit>();
  const audit: PromotionCommissionSplit[] = [];
  let eligibleCum = 0;

  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const actualUnits = Math.max(0, c.unit_count ?? 0);
    if (actualUnits === 0) continue;

    const doubleUp = buildDoubleUpPromotionAudit(c);
    const eligibleUnits = Math.max(0, doubleUp.promotion_eligible_unit_count);
    const eligibleBefore = eligibleCum;
    const eligibleAfter = eligibleBefore + eligibleUnits;

    let prePromotionUnits: number;
    let postPromotionUnits: number;
    let promotionReason: PromotionCommissionReason;

    if (eligibleBefore >= minUnits) {
      // 이미 승급 이후 — 실제 구좌 전부 리더 단가
      prePromotionUnits = 0;
      postPromotionUnits = actualUnits;
      promotionReason = 'AFTER_PROMOTION';
    } else if (eligibleAfter < minUnits) {
      prePromotionUnits = actualUnits;
      postPromotionUnits = 0;
      promotionReason = 'BEFORE_PROMOTION';
    } else {
      // 이 계약의 인정구좌로 20 도달/초과 = 승급 계약 → 실제 구좌는 전부 영업사원 단가
      prePromotionUnits = actualUnits;
      postPromotionUnits = 0;
      promotionReason = 'PROMOTION_CONTRACT';
    }

    eligibleCum = eligibleAfter;

    splitByContractId.set(c.id, {
      prePromotionUnits,
      postPromotionUnits,
    });

    const commissionPerUnit: 300_000 | 400_000 =
      postPromotionUnits > 0 && prePromotionUnits === 0
        ? PROMOTION_LEADER_COMMISSION_PER_UNIT
        : PROMOTION_SALES_COMMISSION_PER_UNIT;

    audit.push({
      contractId: c.id,
      contractCode: String(c.contract_code ?? c.id),
      unitCount: actualUnits,
      cumulativeUnitsBefore: eligibleBefore,
      cumulativeUnitsAfter: eligibleAfter,
      isPromotionContract: promotionReason === 'PROMOTION_CONTRACT',
      commissionPerUnit,
      promotionReason,
      prePromotionUnits,
      postPromotionUnits,
      actualUnitCount: doubleUp.actual_unit_count,
      promotionMultiplier: doubleUp.promotion_multiplier,
      promotionEligibleUnitCount: doubleUp.promotion_eligible_unit_count,
      doubleUpApplied: doubleUp.double_up_applied,
      happyCallSuccessYmd: doubleUp.happy_call_success_ymd,
      commissionUnitCount: doubleUp.commission_unit_count,
      bonusUnitCount: doubleUp.bonus_unit_count,
      doubleUpAppliedReason: doubleUp.applied_reason,
    });
  }

  return { splitByContractId, audit };
}

/** 승격 누적 가입 인정 여부·제외 사유 */
export function explainPromotionAccumulationExclusion(row: {
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  happycall_result?: string | null;
  invoice_no?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
}): { eligible: boolean; exclusion_reason: string | null } {
  if (!row.sales_member_id) {
    return { eligible: false, exclusion_reason: 'NO_SALES_MEMBER' };
  }
  if (row.is_cancelled) {
    return { eligible: false, exclusion_reason: 'CANCELLED' };
  }
  if ((row.sales_link_status ?? 'linked') !== 'linked') {
    return { eligible: false, exclusion_reason: 'SALES_NOT_LINKED' };
  }
  const status = String(row.status ?? '').trim();
  if (status === '가입') {
    return { eligible: true, exclusion_reason: null };
  }
  if (status === '준비' || status === '대기') {
    const hc = String(row.happycall_result ?? '').trim();
    if (!SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hc)) {
      return { eligible: false, exclusion_reason: 'HAPPYCALL_NOT_SUCCESS' };
    }
    if (
      !hasJoinSatisfyingInvoiceNo(row.invoice_no, {
        product_type: row.product_type,
        item_name: row.item_name,
        source_snapshot_json: row.source_snapshot_json,
      })
    ) {
      return { eligible: false, exclusion_reason: 'INVOICE_MISSING' };
    }
    return { eligible: true, exclusion_reason: null };
  }
  return { eligible: false, exclusion_reason: 'STATUS_NOT_ELIGIBLE' };
}

function explainPromotionWalkJoinExclusion(
  row: JoinStatusContractCandidate,
): { exclusion_reason: string; excluded_by_v2_eligibility: boolean } {
  const { eligible, exclusion_reason } = explainPromotionAccumulationExclusion(row);
  if (eligible) {
    return { exclusion_reason: 'NOT_IN_JOIN_ATTRIBUTED', excluded_by_v2_eligibility: false };
  }
  return {
    exclusion_reason: exclusion_reason ?? 'NOT_ELIGIBLE',
    excluded_by_v2_eligibility: false,
  };
}

type WalkJoinUnitMode = 'actual' | 'eligible';

function walkUnitsForMode(c: AttributedJoinContractRow, mode: WalkJoinUnitMode): number {
  const actual = Math.max(0, c.unit_count ?? 0);
  if (mode === 'actual') return actual;
  return promotionEligibleUnitsForContract(c);
}

/** 산하 walk 누적 통계 (이벤트 불일치 감사용) */
export function computeWalkJoinStatsForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  thresholdContractId?: string | null,
  mode: WalkJoinUnitMode = 'actual',
): { walk_total_join_units: number; walk_cumulative_units_at_threshold: number | null } {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  let cum = 0;
  let walkTotal = 0;
  let walkCumAtThreshold: number | null = null;
  const thId = thresholdContractId ?? null;

  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const units = walkUnitsForMode(c, mode);
    if (units === 0) continue;
    if (thId && c.id === thId) {
      walkCumAtThreshold = cum;
    }
    cum += units;
    walkTotal += units;
  }

  return {
    walk_total_join_units: walkTotal,
    walk_cumulative_units_at_threshold: walkCumAtThreshold,
  };
}

/** 승급 판정 전용 walk 누적 (더블업 인정구좌 반영) */
export function computePromotionEligibleWalkJoinStatsForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  thresholdContractId?: string | null,
): { walk_total_join_units: number; walk_cumulative_units_at_threshold: number | null } {
  return computeWalkJoinStatsForMember(
    memberId,
    treeRows,
    joinContractsAttributed,
    thresholdContractId,
    'eligible',
  );
}

function collectMemberSubtreeWalkRows(
  memberId: string,
  treeRows: OrgTreeRow[],
  sorted: AttributedJoinContractRow[],
): AttributedJoinContractRow[] {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  return sorted.filter((c) => subtree.has(c.sales_member_id) && Math.max(0, c.unit_count ?? 0) > 0);
}

/** walk 에서 threshold 계약이 누적 20구좌 경계를 가로지르는지 */
export function thresholdCrossesPromotionBoundaryInWalk(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinAttributed: AttributedJoinContractRow[],
  thresholdContractId: string,
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
): boolean {
  const sorted = [...joinAttributed].sort(compareAttributedJoinRows);
  const rows = collectMemberSubtreeWalkRows(memberId, treeRows, sorted);
  let cum = 0;
  for (const c of rows) {
    const units = promotionEligibleUnitsForContract(c);
    if (c.id === thresholdContractId) {
      return cum < minUnits && cum + units >= minUnits;
    }
    cum += units;
  }
  return false;
}

export type PromotionEventValidationStatus =
  | 'WALK_MATCHES_EVENT'
  | 'WALK_EVENT_MISMATCH'
  | 'WALK_BELOW_MIN_UNITS'
  | 'EVENT_THRESHOLD_NOT_IN_WALK';

export type PromotionCommissionStrategy = 'WALK_SSOT';

export type PromotionWalkContractAuditRow = {
  contract_id: string;
  contract_code: string | null;
  unit_count: number;
  order_ymd: string;
  cumulative_units_before: number;
  cumulative_units_after: number;
  is_threshold: boolean;
  /** 실제 계약 구좌 (unit_count와 동일, 감사 표시용) */
  actual_unit_count?: number;
  promotion_multiplier?: 1 | 2;
  promotion_eligible_units?: number;
  double_up_applied?: boolean;
  happy_call_success_ymd?: string | null;
  commission_unit_count?: number;
  bonus_unit_count?: number;
  double_up_applied_reason?: string | null;
};

/** leader_promotion_events 신뢰도·수당 전략 판정 결과 */
export type PromotionEventValidation = {
  status: PromotionEventValidationStatus;
  member_id: string;
  threshold_contract_id: string;
  threshold_join_date: string;
  event_created_at: string | null;
  walk_total_join_units: number;
  walk_cumulative_units_at_threshold: number | null;
  legacy_total_join_units: number;
  legacy_cumulative_units_at_threshold: number | null;
  threshold_units_on_contract: number | null;
  canonical_walk_contracts: PromotionWalkContractAuditRow[];
  legacy_walk_contracts: PromotionWalkContractAuditRow[];
  excluded_from_canonical_walk: PromotionEventWalkMismatch['excluded_join_contracts'];
  commission_strategy: PromotionCommissionStrategy;
  requires_review: boolean;
  status_reason: string;
};

function findContractUnitsById(
  contractId: string,
  ...sources: ReadonlyArray<AttributedJoinContractRow | JoinStatusContractCandidate>[]
): number | null {
  for (const src of sources) {
    for (const c of src) {
      if (c.id === contractId) return Math.max(0, c.unit_count ?? 0);
    }
  }
  return null;
}

/** 가입 인정 후보 → AttributedJoinContractRow (승격 walk용) */
export function buildLegacyJoinAttributedFromCandidates(
  candidates: ReadonlyArray<JoinStatusContractCandidate>,
  subtree: Set<string>,
): AttributedJoinContractRow[] {
  const rows: AttributedJoinContractRow[] = [];
  for (const c of candidates) {
    if (!subtree.has(c.sales_member_id)) continue;
    if (!isPromotionAccumulationJoinContractRow(c)) continue;
    const units = Math.max(0, c.unit_count ?? 0);
    if (units === 0) continue;
    rows.push({
      id: c.id,
      contract_code: c.contract_code ?? null,
      status: String(c.status ?? ''),
      join_date: String(c.join_date ?? '').slice(0, 10),
      unit_count: units,
      sales_member_id: c.sales_member_id,
      created_at: (c.created_at ?? null) as string | null,
      happy_call_at: (c.happy_call_at != null ? String(c.happy_call_at) : null) as string | null,
      invoice_registered_at: (c.invoice_registered_at ?? null) as string | null,
      happycall_result: (c.happycall_result ?? null) as string | null,
      invoice_no: (c.invoice_no ?? null) as string | null,
      product_type: (c.product_type ?? null) as string | null,
      item_name: (c.item_name ?? null) as string | null,
      source_snapshot_json: (c.source_snapshot_json ?? null) as Record<string, string | null> | null,
    });
  }
  return rows;
}

function collectWalkAuditRows(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinRows: AttributedJoinContractRow[],
  thresholdContractId: string,
  mode: WalkJoinUnitMode = 'actual',
): PromotionWalkContractAuditRow[] {
  const sorted = [...joinRows].sort(compareAttributedJoinRows);
  const rows = collectMemberSubtreeWalkRows(memberId, treeRows, sorted);
  const out: PromotionWalkContractAuditRow[] = [];
  let cum = 0;
  for (const c of rows) {
    const actualUnits = Math.max(0, c.unit_count ?? 0);
    const walkUnits = walkUnitsForMode(c, mode);
    const doubleUp = buildDoubleUpPromotionAudit(c);
    const cumBefore = cum;
    cum += walkUnits;
    out.push({
      contract_id: c.id,
      contract_code: c.contract_code ?? null,
      unit_count: actualUnits,
      order_ymd: contractJoinOrderYmd(c),
      cumulative_units_before: cumBefore,
      cumulative_units_after: cum,
      is_threshold: c.id === thresholdContractId,
      actual_unit_count: doubleUp.actual_unit_count,
      promotion_multiplier: doubleUp.promotion_multiplier,
      promotion_eligible_units: doubleUp.promotion_eligible_unit_count,
      double_up_applied: doubleUp.double_up_applied,
      happy_call_success_ymd: doubleUp.happy_call_success_ymd,
      commission_unit_count: doubleUp.commission_unit_count,
      bonus_unit_count: doubleUp.bonus_unit_count,
      double_up_applied_reason: doubleUp.applied_reason,
    });
  }
  return out;
}

/** 승급 판정 walk 감사 (더블업 인정구좌 누적) */
export function collectPromotionEligibleWalkAuditRows(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinRows: AttributedJoinContractRow[],
  thresholdContractId: string,
): PromotionWalkContractAuditRow[] {
  return collectWalkAuditRows(memberId, treeRows, joinRows, thresholdContractId, 'eligible');
}

function collectExcludedFromCanonicalWalk(
  subtree: Set<string>,
  joinAttributed: AttributedJoinContractRow[],
  joinStatusCandidates: ReadonlyArray<JoinStatusContractCandidate>,
): PromotionEventWalkMismatch['excluded_join_contracts'] {
  const joinAttributedIds = new Set(joinAttributed.map((c) => c.id));
  const excluded: PromotionEventWalkMismatch['excluded_join_contracts'] = [];
  for (const c of joinStatusCandidates) {
    if (!subtree.has(c.sales_member_id)) continue;
    const st = String(c.status ?? '').trim();
    if (st !== '가입' && st !== '준비' && st !== '대기') continue;
    if (joinAttributedIds.has(c.id)) continue;
    const { exclusion_reason, excluded_by_v2_eligibility } = explainPromotionWalkJoinExclusion(c);
    excluded.push({
      contract_id: c.id,
      contract_code: c.contract_code ?? null,
      unit_count: Math.max(0, c.unit_count ?? 0),
      exclusion_reason,
      excluded_by_v2_eligibility,
    });
  }
  return excluded;
}

/** threshold 계약 시점에 walk 기준 20구좌 달성이 입증되는지 (날짜 비교 없음) */
export function promotionProvenAtThreshold(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinRows: AttributedJoinContractRow[],
  thresholdContractId: string,
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
): boolean {
  const stats = computePromotionEligibleWalkJoinStatsForMember(
    memberId,
    treeRows,
    joinRows,
    thresholdContractId,
  );
  if (stats.walk_cumulative_units_at_threshold === null) return false;
  if (
    thresholdCrossesPromotionBoundaryInWalk(
      memberId,
      treeRows,
      joinRows,
      thresholdContractId,
      minUnits,
    )
  ) {
    return true;
  }
  const thRow = joinRows.find((c) => c.id === thresholdContractId);
  const eligibleUnits = promotionEligibleUnitsForContract({
    unit_count: thRow?.unit_count ?? findContractUnitsById(thresholdContractId, joinRows) ?? 0,
    happy_call_at: thRow?.happy_call_at,
    happycall_result: thRow?.happycall_result,
    status: thRow?.status,
  });
  return stats.walk_cumulative_units_at_threshold + eligibleUnits >= minUnits;
}

/**
 * leader_promotion_events vs walk 감사 (수당은 항상 walk SSOT).
 */
export function validatePromotionEvent(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  joinAttributed: AttributedJoinContractRow[];
  joinStatusCandidates: ReadonlyArray<JoinStatusContractCandidate>;
  event: LeaderPromotionEventRecord;
  threshold: SalesMemberPromotionThreshold;
  minUnits?: number;
}): PromotionEventValidation {
  const minUnits = params.minUnits ?? LEADER_PROMOTION_MIN_UNITS;
  const { memberId, treeRows, joinAttributed, joinStatusCandidates, event, threshold } = params;
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);

  const walkNatural = computePromotionThresholdForMember(memberId, treeRows, joinAttributed, minUnits);
  const walkNaturalId = walkNatural?.threshold_contract_id ?? null;
  const eventId = threshold.threshold_contract_id;

  const canonicalStats = computePromotionEligibleWalkJoinStatsForMember(
    memberId,
    treeRows,
    joinAttributed,
    eventId,
  );
  const actualStats = computeWalkJoinStatsForMember(
    memberId,
    treeRows,
    joinAttributed,
    eventId,
    'actual',
  );
  const thresholdInWalk = canonicalStats.walk_cumulative_units_at_threshold !== null;
  const canonicalWalkRows = collectPromotionEligibleWalkAuditRows(
    memberId,
    treeRows,
    joinAttributed,
    eventId,
  );
  const excluded = collectExcludedFromCanonicalWalk(subtree, joinAttributed, joinStatusCandidates);
  const thresholdUnits = findContractUnitsById(eventId, joinAttributed);

  let status: PromotionEventValidationStatus;
  let status_reason: string;

  if (!thresholdInWalk) {
    status = 'EVENT_THRESHOLD_NOT_IN_WALK';
    status_reason = '이벤트 threshold 계약이 가입 인정 walk에 없음';
  } else if (canonicalStats.walk_total_join_units < minUnits) {
    status = 'WALK_BELOW_MIN_UNITS';
    status_reason = `가입 인정 walk 총 ${canonicalStats.walk_total_join_units}구좌 (< ${minUnits})`;
  } else if (walkNaturalId && walkNaturalId === eventId) {
    status = 'WALK_MATCHES_EVENT';
    status_reason = 'walk 20구좌 달성 계약과 이벤트 threshold 일치';
  } else {
    status = 'WALK_EVENT_MISMATCH';
    status_reason = walkNaturalId
      ? `walk 20구좌 계약(${walkNaturalId}) ≠ 이벤트 threshold(${eventId})`
      : 'walk 20구좌 미달성';
  }

  return {
    status,
    member_id: memberId,
    threshold_contract_id: eventId,
    threshold_join_date: threshold.threshold_join_date,
    event_created_at: event.created_at ?? null,
    walk_total_join_units: canonicalStats.walk_total_join_units,
    walk_cumulative_units_at_threshold: canonicalStats.walk_cumulative_units_at_threshold,
    legacy_total_join_units: actualStats.walk_total_join_units,
    legacy_cumulative_units_at_threshold: actualStats.walk_cumulative_units_at_threshold,
    threshold_units_on_contract: thresholdUnits,
    canonical_walk_contracts: canonicalWalkRows,
    legacy_walk_contracts: canonicalWalkRows,
    excluded_from_canonical_walk: excluded,
    commission_strategy: 'WALK_SSOT',
    requires_review: status === 'WALK_EVENT_MISMATCH' || status === 'EVENT_THRESHOLD_NOT_IN_WALK',
    status_reason,
  };
}

/** 산하 후보 계약 중 가입 인정 walk에서 제외된 계약·사유 (감사용) */
export function auditPromotionWalkExclusionsForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinAttributed: AttributedJoinContractRow[],
  joinStatusCandidates: ReadonlyArray<JoinStatusContractCandidate>,
): PromotionEventWalkMismatch['excluded_join_contracts'] {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  return collectExcludedFromCanonicalWalk(subtree, joinAttributed, joinStatusCandidates);
}

/** 운영 감사: 멤버 walk 누적·계약별 수당 요약 */
export function formatPromotionWalkCommissionReport(
  memberName: string,
  memberId: string,
  audit: PromotionCommissionSplit[],
): string {
  const lines = [
    `=== 승격 walk 수당: ${memberName} (${memberId}) ===`,
    `총 ${audit.length}건 / 누적 ${audit[audit.length - 1]?.cumulativeUnitsAfter ?? 0}구좌`,
    '',
  ];
  for (const a of audit) {
    lines.push(
      `  ${a.contractCode} hc_order=${a.cumulativeUnitsBefore}→${a.cumulativeUnitsAfter} ` +
        `units=${a.unitCount} ${a.commissionPerUnit / 10_000}만 ` +
        `${a.promotionReason}${a.isPromotionContract ? ' [20구좌]' : ''}`,
    );
  }
  return lines.join('\n');
}

/** 운영 감사·스크립트용 사람이 읽기 쉬운 요약 */
export function formatPromotionEventAuditReport(validation: PromotionEventValidation): string {
  const lines: string[] = [
    `=== 승급 이벤트 감사: ${validation.member_id} ===`,
    `status: ${validation.status}`,
    `commission_strategy: ${validation.commission_strategy}`,
    `requires_review: ${validation.requires_review}`,
    `reason: ${validation.status_reason}`,
    '',
    `threshold_contract_id: ${validation.threshold_contract_id}`,
    `threshold_join_date: ${validation.threshold_join_date}`,
    `event_created_at: ${validation.event_created_at ?? '(없음)'}`,
    `threshold_units_on_contract: ${validation.threshold_units_on_contract ?? '(미확인)'}`,
    '',
    `canonical walk: total=${validation.walk_total_join_units}, cum_at_threshold=${validation.walk_cumulative_units_at_threshold ?? 'null'}`,
    `legacy walk: total=${validation.legacy_total_join_units}, cum_at_threshold=${validation.legacy_cumulative_units_at_threshold ?? 'null'}`,
    '',
    '--- 가입 인정 walk 계약 ---',
    ...validation.canonical_walk_contracts.map(
      (c) =>
        `  ${c.contract_code ?? c.contract_id} units=${c.unit_count} order=${c.order_ymd} cum=${c.cumulative_units_before}→${c.cumulative_units_after}${c.is_threshold ? ' [이벤트 THRESHOLD]' : ''}`,
    ),
    '',
    `--- walk 제외 계약 (${validation.excluded_from_canonical_walk.length}건) ---`,
    ...validation.excluded_from_canonical_walk.map(
      (e) =>
        `  ${e.contract_code ?? e.contract_id} units=${e.unit_count} reason=${e.exclusion_reason} v2=${e.excluded_by_v2_eligibility}`,
    ),
  ];
  return lines.join('\n');
}

/**
 * 승급 이벤트 vs walk 불일치 감사 (하위 호환).
 * {@link validatePromotionEvent} 결과를 요약한다.
 */
export function auditPromotionEventWalkMismatch(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  joinAttributed: AttributedJoinContractRow[];
  joinStatusCandidates: ReadonlyArray<JoinStatusContractCandidate>;
  event: LeaderPromotionEventRecord;
  threshold: SalesMemberPromotionThreshold;
}): PromotionEventWalkMismatch | null {
  const validation = validatePromotionEvent(params);
  if (validation.status === 'WALK_MATCHES_EVENT' || validation.status === 'WALK_BELOW_MIN_UNITS') {
    return null;
  }

  return {
    type: 'PROMOTION_EVENT_WALK_MISMATCH',
    validation_status: validation.status,
    member_id: validation.member_id,
    promotion_event_id: validation.member_id,
    threshold_contract_id: validation.threshold_contract_id,
    event_created_at: validation.event_created_at,
    walk_cumulative_units_at_threshold: validation.walk_cumulative_units_at_threshold,
    walk_total_join_units: validation.walk_total_join_units,
    legacy_total_join_units: validation.legacy_total_join_units,
    legacy_cumulative_units_at_threshold: validation.legacy_cumulative_units_at_threshold,
    excluded_join_contracts: validation.excluded_from_canonical_walk,
    requires_review: validation.requires_review,
    status_reason: validation.status_reason,
  };
}

function memberUsesEventThresholdSplit(
  memberId: string,
  options?: PromotionUnitSplitBuildOptions,
): { event: LeaderPromotionEventRecord; threshold: SalesMemberPromotionThreshold } | null {
  const threshold = options?.promotionThresholdByMemberId?.get(memberId) ?? null;
  if (!threshold?.threshold_contract_id) return null;

  const eventFromMap = options?.promotionEventsByMemberId?.get(memberId);
  if (eventFromMap?.threshold_contract_id) {
    return { event: eventFromMap, threshold };
  }
  if (options?.eventThresholdMemberIds?.has(memberId)) {
    return {
      event: {
        member_id: memberId,
        threshold_contract_id: threshold.threshold_contract_id,
        threshold_join_date: threshold.threshold_join_date,
        created_at: null,
      },
      threshold,
    };
  }
  return null;
}

/**
 * @deprecated {@link validatePromotionEvent} 의 commission_strategy 를 사용한다.
 */
export function shouldUseEventThresholdSplitForCommission(
  _memberId: string,
  _treeRows: OrgTreeRow[],
  _joinAttributed: AttributedJoinContractRow[],
  _threshold: SalesMemberPromotionThreshold,
  _minUnits: number = LEADER_PROMOTION_MIN_UNITS,
  _joinStatusCandidates: ReadonlyArray<JoinStatusContractCandidate> = [],
): boolean {
  return false;
}

function resolvePromotionSplitForMember(
  memberId: string,
  subtree: Set<string>,
  sorted: AttributedJoinContractRow[],
  minUnits: number,
  options?: PromotionUnitSplitBuildOptions,
): { splitByContractId: Map<string, PromotionUnitSplit>; audit: PromotionCommissionSplit[] } {
  const eventCtx = memberUsesEventThresholdSplit(memberId, options);
  if (eventCtx && options?.treeRows) {
    const { event, threshold } = eventCtx;
    const validation = validatePromotionEvent({
      memberId,
      treeRows: options.treeRows,
      joinAttributed: sorted,
      joinStatusCandidates: options.joinStatusCandidates ?? [],
      event,
      threshold,
      minUnits,
    });
    if (options.validationOut) {
      options.validationOut.push(validation);
    }
    if (options.walkMismatchOut) {
      const mismatch = auditPromotionEventWalkMismatch({
        memberId,
        treeRows: options.treeRows,
        joinAttributed: sorted,
        joinStatusCandidates: options.joinStatusCandidates ?? [],
        event,
        threshold,
      });
      if (mismatch) options.walkMismatchOut.push(mismatch);
    }
  }
  return promotionWalkFromCumulative(sorted, subtree, minUnits);
}

function promotionReasonFromThresholdSplit(
  contractId: string,
  split: PromotionUnitSplit,
  threshold: SalesMemberPromotionThreshold,
): PromotionCommissionReason {
  if (contractId === threshold.threshold_contract_id) {
    return 'PROMOTION_CONTRACT';
  }
  if (split.postPromotionUnits > 0 && split.prePromotionUnits === 0) {
    return 'AFTER_PROMOTION';
  }
  if (split.prePromotionUnits > 0 && split.postPromotionUnits > 0) {
    return 'PROMOTION_CONTRACT';
  }
  return 'BEFORE_PROMOTION';
}

/**
 * `leader_promotion_events`에 기록된 승격 계약(threshold) 기준 분할.
 * {@link shouldUseEventThresholdSplitForCommission} 가 true 일 때만 사용한다.
 */
function promotionSplitFromRecordedThreshold(
  subtree: Set<string>,
  sorted: AttributedJoinContractRow[],
  threshold: SalesMemberPromotionThreshold,
): { splitByContractId: Map<string, PromotionUnitSplit>; audit: PromotionCommissionSplit[] } {
  const splitByContractId = new Map<string, PromotionUnitSplit>();
  const audit: PromotionCommissionSplit[] = [];
  let cum = 0;

  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const units = Math.max(0, c.unit_count ?? 0);
    if (units === 0) continue;

    const cumBefore = cum;
    cum += units;

    const split = splitContractUnitsByPromotionThreshold(
      {
        id: c.id,
        join_date: c.join_date,
        unit_count: units,
        happy_call_at: c.happy_call_at ?? null,
        invoice_registered_at: c.invoice_registered_at ?? null,
        created_at: c.created_at ?? null,
      },
      threshold,
    );
    splitByContractId.set(c.id, split);

    const promotionReason = promotionReasonFromThresholdSplit(c.id, split, threshold);
    const commissionPerUnit: 300_000 | 400_000 =
      split.postPromotionUnits > 0 && split.prePromotionUnits === 0
        ? PROMOTION_LEADER_COMMISSION_PER_UNIT
        : PROMOTION_SALES_COMMISSION_PER_UNIT;

    audit.push({
      contractId: c.id,
      contractCode: String(c.contract_code ?? c.id),
      unitCount: units,
      cumulativeUnitsBefore: cumBefore,
      cumulativeUnitsAfter: cum,
      isPromotionContract: promotionReason === 'PROMOTION_CONTRACT',
      commissionPerUnit,
      promotionReason,
      prePromotionUnits: split.prePromotionUnits,
      postPromotionUnits: split.postPromotionUnits,
    });
  }

  return { splitByContractId, audit };
}

export type LeaderPromotionEventRecord = {
  member_id: string;
  threshold_contract_id: string;
  threshold_join_date: string;
  previous_parent_id?: string | null;
  created_at?: string | null;
};

/** 승급 이벤트 vs walk 불일치 감사 (하위 호환 요약) */
export type PromotionEventWalkMismatch = {
  type: 'PROMOTION_EVENT_WALK_MISMATCH';
  validation_status: PromotionEventValidationStatus;
  member_id: string;
  /** leader_promotion_events PK (= member_id) */
  promotion_event_id: string;
  threshold_contract_id: string;
  event_created_at: string | null;
  walk_cumulative_units_at_threshold: number | null;
  walk_total_join_units: number;
  legacy_total_join_units: number;
  legacy_cumulative_units_at_threshold: number | null;
  requires_review: boolean;
  status_reason: string;
  excluded_join_contracts: Array<{
    contract_id: string;
    contract_code: string | null;
    unit_count: number;
    exclusion_reason: string;
    excluded_by_v2_eligibility: boolean;
  }>;
};

/** walk 제외 감사용: status=가입 후보 계약 */
export type JoinStatusContractCandidate = {
  id: string;
  contract_code?: string | null;
  unit_count: number;
  sales_member_id: string;
  join_date?: string | null;
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_link_status?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  invoice_no?: string | null;
  invoice_registered_at?: string | null;
  created_at?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

export type PromotionUnitSplitBuildOptions = {
  minUnits?: number;
  promotionThresholdByMemberId?: Map<string, SalesMemberPromotionThreshold | null>;
  /** 유효한 leader_promotion_events (threshold_contract_id 포함) */
  promotionEventsByMemberId?: ReadonlyMap<string, LeaderPromotionEventRecord>;
  /** @deprecated {@link promotionEventsByMemberId} 사용 */
  eventThresholdMemberIds?: ReadonlySet<string>;
  /** status=가입 이지만 joinAttributed 에 없는 계약 — 불일치·legacy walk 감사용 */
  joinStatusCandidates?: ReadonlyArray<JoinStatusContractCandidate>;
  /** 불일치 감지 시 누적 (하위 호환) */
  walkMismatchOut?: PromotionEventWalkMismatch[];
  /** 승급 이벤트 신뢰도 판정 전체 감사 */
  validationOut?: PromotionEventValidation[];
  /** 내부: 불일치 감사용 treeRows */
  treeRows?: OrgTreeRow[];
};

export type PromotionUnitSplit = {
  prePromotionUnits: number;
  postPromotionUnits: number;
};

export type PromotionCommissionReason =
  | 'BEFORE_PROMOTION'
  | 'PROMOTION_CONTRACT'
  | 'AFTER_PROMOTION'
  | 'NOT_JOIN_CONTRACT';

export type PromotionCommissionSplit = {
  contractId: string;
  contractCode: string;
  unitCount: number;
  cumulativeUnitsBefore: number;
  cumulativeUnitsAfter: number;
  isPromotionContract: boolean;
  commissionPerUnit: 300_000 | 400_000;
  promotionReason: PromotionCommissionReason;
  prePromotionUnits: number;
  postPromotionUnits: number;
  /** 더블업 감사 — 수당 수량은 unitCount(실제 구좌), 승급 경계·단가는 인정구좌 누적 */
  actualUnitCount?: number;
  promotionMultiplier?: 1 | 2;
  promotionEligibleUnitCount?: number;
  doubleUpApplied?: boolean;
  happyCallSuccessYmd?: string | null;
  commissionUnitCount?: number;
  bonusUnitCount?: number;
  doubleUpAppliedReason?: string | null;
};

export const PROMOTION_SALES_COMMISSION_PER_UNIT = 300_000 as const;
export const PROMOTION_LEADER_COMMISSION_PER_UNIT = 400_000 as const;

function classifyPromotionUnits(
  cumBefore: number,
  units: number,
  minUnits: number,
): { prePromotionUnits: number; postPromotionUnits: number; promotionReason: PromotionCommissionReason } {
  if (units <= 0) {
    return { prePromotionUnits: 0, postPromotionUnits: 0, promotionReason: 'BEFORE_PROMOTION' };
  }
  const cumAfter = cumBefore + units;
  if (cumBefore >= minUnits) {
    return { prePromotionUnits: 0, postPromotionUnits: units, promotionReason: 'AFTER_PROMOTION' };
  }
  if (cumAfter <= minUnits) {
    return {
      prePromotionUnits: units,
      postPromotionUnits: 0,
      promotionReason: cumAfter === minUnits ? 'PROMOTION_CONTRACT' : 'BEFORE_PROMOTION',
    };
  }
  const pre = minUnits - cumBefore;
  return {
    prePromotionUnits: pre,
    postPromotionUnits: units - pre,
    promotionReason: 'PROMOTION_CONTRACT',
  };
}

/** 가입 누적 구좌·승격 수당 판정에 포함되는 계약 */
export function isPromotionAccumulationJoinContractRow(row: {
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  invoice_no?: string | null;
}): boolean {
  return explainPromotionAccumulationExclusion(row).eligible;
}

/** @deprecated {@link isPromotionAccumulationJoinContractRow} 와 동일 */
export function isLeaderPromotionJoinContractRow(row: {
  status?: string | null;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  invoice_no?: string | null;
}): boolean {
  return isPromotionAccumulationJoinContractRow(row);
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
  promotion_eligible_units: number;
  promotion_multiplier: 1 | 2;
  double_up_applied: boolean;
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
    promotion_eligible_units: number;
    promotion_multiplier: 1 | 2;
    double_up_applied: boolean;
  }> = [];
  let eligibleCum = 0;
  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const actualUnits = Math.max(0, c.unit_count ?? 0);
    const eligibleUnits = promotionEligibleUnitsForContract(c);
    const doubleUp = buildDoubleUpPromotionAudit(c);
    const cumBefore = eligibleCum;
    eligibleCum += eligibleUnits;
    out.push({
      contract_id: c.id,
      order_ymd: contractJoinOrderYmd(c),
      invoice_registered_at: c.invoice_registered_at ?? null,
      unit_count: actualUnits,
      cum_before: cumBefore,
      cum_after: eligibleCum,
      is_threshold: eligibleCum >= minUnits && cumBefore < minUnits,
      promotion_eligible_units: eligibleUnits,
      promotion_multiplier: doubleUp.promotion_multiplier,
      double_up_applied: doubleUp.double_up_applied,
    });
    if (eligibleCum >= minUnits) break;
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

/**
 * 정산월 말 시점까지 산하 승급 인정 walk 누적 (더블업 배수 반영, 해피콜 순서일 기준).
 */
export function subtreePromotionEligibleWalkUnitsAsOf(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  asOfInclusive: string,
): number {
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const rows = collectMemberSubtreeWalkRows(memberId, treeRows, sorted);
  const cap = asOfInclusive.slice(0, 10);
  let sum = 0;
  for (const c of rows) {
    const orderYmd = contractJoinOrderYmd(c);
    if (orderYmd > cap) continue;
    sum += promotionEligibleUnitsForContract(c);
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

function isLeaderOrAboveRank(rank: RankType | undefined): boolean {
  return rank === '리더' || rank === '센터장' || rank === '사업본부장' || rank === '본사';
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
      if (isLeaderOrAboveRank(r)) continue;
      stack.push(ch);
    }
  }
  return out;
}

/**
 * 유지장려 하위 리더 컷에서 잘린 리더급 자식들.
 * (baseSubtree에 속한 노드의 자식 중 리더 이상)
 */
function collectCutDownLeaderIds(
  baseSubtree: Set<string>,
  childrenByParent: Map<string, string[]>,
  rankById: Map<string, RankType>,
): string[] {
  const cut: string[] = [];
  for (const id of baseSubtree) {
    for (const ch of childrenByParent.get(id) ?? []) {
      if (isLeaderOrAboveRank(rankById.get(ch))) cut.push(ch);
    }
  }
  return cut;
}

/**
 * 정산월 해피콜 윈도우(start~end) 내 산하 '가입' 구좌 합 — **유지장려금 전용**.
 *
 * 기준일은 join_date 가 아니라 happy_call_at(서울 YMD)이다.
 * 윈도우 경계는 정산 v2 `getHappycallWindowForYearMonth` 와 동일하게 호출 측에서 넘긴다.
 *
 * 규칙:
 *  - 기본: 하위 리더·센터장·본부장·본사 조직은 제외(해당 리더 본인 유지장려에만 잡힘).
 *  - 예외: 잘린 하위 리더(센터장 등)가 영업사원→리더 승급한 경우,
 *    그 승급 확정 계약까지(승급 전 구좌)는 상위 리더 유지장려에 포함한다.
 *
 * 예) 리더 A 산하 영업사원 B가 승급해 리더가 된 뒤:
 *  - B 승급 전·승급 확정 계약 구좌 → A 유지장려에 포함
 *  - B 승급 이후 구좌 → A에서 제외(B 본인 유지장려에만)
 */
export function subtreeJoinUnitsForLeaderMaintenanceInWindow(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  joinContractsAttributed: AttributedJoinContractRow[];
  startInclusive: string;
  endInclusive: string;
  /** 하위 승급자 컷 예외(승급 확정 계약까지 포함)에 사용 */
  promotionThresholdByMemberId?: Map<string, SalesMemberPromotionThreshold | null>;
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const rankById = new Map<string, RankType>();
  for (const r of params.treeRows) rankById.set(r.id, r.rank);

  const baseSubtree = collectSubtreeMemberIdsExcludingDownLeaders(
    params.memberId,
    childrenByParent,
    rankById,
  );
  const start = params.startInclusive.slice(0, 10);
  const end = params.endInclusive.slice(0, 10);
  let sum = 0;
  for (const c of params.joinContractsAttributed) {
    if (!baseSubtree.has(c.sales_member_id)) continue;
    const periodYmd = leaderMaintenancePeriodYmd(c);
    if (!periodYmd || periodYmd < start || periodYmd > end) continue;
    sum += Math.max(0, c.unit_count ?? 0);
  }

  const thresholds = params.promotionThresholdByMemberId;
  if (!thresholds) return sum;

  const cutLeaders = collectCutDownLeaderIds(baseSubtree, childrenByParent, rankById);
  for (const cutId of cutLeaders) {
    const th = thresholds.get(cutId) ?? null;
    if (!th) continue;
    const underCut = collectSubtreeMemberIdsDownstream(cutId, childrenByParent);
    const walk = params.promotionUnitSplitByMemberId?.get(cutId);
    for (const c of params.joinContractsAttributed) {
      if (!underCut.has(c.sales_member_id)) continue;
      const periodYmd = leaderMaintenancePeriodYmd(c);
      if (!periodYmd || periodYmd < start || periodYmd > end) continue;
      const pre = resolvePromotionUnitSplit(
        {
          id: c.id,
          join_date: c.join_date,
          happy_call_at: c.happy_call_at,
          invoice_registered_at: c.invoice_registered_at,
          created_at: c.created_at,
          unit_count: Math.max(0, c.unit_count ?? 0),
        },
        walk,
        th,
      ).prePromotionUnits;
      sum += pre;
    }
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

/** 사업본부장 승격: 산하 센터장 최소 인원 */
export const DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS = 3;

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
  let eligibleCum = 0;
  let actualCum = 0;
  for (const c of sorted) {
    if (!subtree.has(c.sales_member_id)) continue;
    const actualUnits = Math.max(0, c.unit_count ?? 0);
    if (actualUnits === 0) continue;
    const eligibleUnits = promotionEligibleUnitsForContract(c);
    const actualBefore = actualCum;
    eligibleCum += eligibleUnits;
    actualCum += actualUnits;
    if (eligibleCum >= minUnits) {
      return {
        threshold_contract_id: c.id,
        threshold_join_date:
          normalizeCreatedAt(c.happy_call_at).slice(0, 10) || contractJoinOrderYmd(c),
        threshold_invoice_registered_at: c.invoice_registered_at ?? null,
        threshold_created_at: c.created_at ?? null,
        threshold_pre_promotion_units_on_contract: prePromotionUnitsOnThresholdContract(
          actualUnits,
          actualBefore,
          minUnits,
        ),
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

  // 수당 walk는 실제 구좌 SSOT — pre 구좌도 실제 누적으로만 보강한다.
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
 * 수당 SSOT: 산하 전체 가입 계약 + happy_call_at → invoice_registered_at(초) → created_at → id 정렬 + 누적 20구좌.
 */
export function buildPromotionUnitSplitByContractId(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
  options?: PromotionUnitSplitBuildOptions,
): Map<string, PromotionUnitSplit> {
  return buildPromotionCommissionWalkForMember(
    memberId,
    treeRows,
    joinContractsAttributed,
    minUnits,
    options,
  ).splitByContractId;
}

/** 멤버 산하 가입 누적 walk + 검증용 audit */
export function buildPromotionCommissionWalkForMember(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnits: number = LEADER_PROMOTION_MIN_UNITS,
  options?: PromotionUnitSplitBuildOptions,
): { splitByContractId: Map<string, PromotionUnitSplit>; audit: PromotionCommissionSplit[] } {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const resolvedOptions: PromotionUnitSplitBuildOptions = {
    ...options,
    treeRows: options?.treeRows ?? treeRows,
  };
  return resolvePromotionSplitForMember(memberId, subtree, sorted, minUnits, resolvedOptions);
}

/** 영업사원·리더 전원에 대해 split 맵 일괄 생성 (정책 승격자는 이벤트 threshold 우선) */
export function buildPromotionUnitSplitByMemberIds(
  memberIds: Iterable<string>,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  minUnitsOrOptions: number | PromotionUnitSplitBuildOptions = LEADER_PROMOTION_MIN_UNITS,
  maybeOptions?: PromotionUnitSplitBuildOptions,
): Map<string, Map<string, PromotionUnitSplit>> {
  const options: PromotionUnitSplitBuildOptions =
    typeof minUnitsOrOptions === 'number'
      ? { minUnits: minUnitsOrOptions, ...maybeOptions }
      : minUnitsOrOptions;
  const minUnits = options.minUnits ?? LEADER_PROMOTION_MIN_UNITS;
  const resolvedOptions: PromotionUnitSplitBuildOptions = {
    ...options,
    treeRows: options.treeRows ?? treeRows,
  };

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const sorted = [...joinContractsAttributed].sort(compareAttributedJoinRows);
  const out = new Map<string, Map<string, PromotionUnitSplit>>();
  for (const memberId of memberIds) {
    const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
    const { splitByContractId } = resolvePromotionSplitForMember(
      memberId,
      subtree,
      sorted,
      minUnits,
      resolvedOptions,
    );
    out.set(memberId, splitByContractId);
  }
  return out;
}

/** @deprecated {@link buildPromotionUnitSplitByMemberIds} 사용 */
export function buildPromotionUnitSplitByMemberId(
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
): Map<string, Map<string, PromotionUnitSplit>> {
  return buildPromotionUnitSplitByMemberIds(
    [...promotionThresholdByMemberId.keys()].filter((id) => promotionThresholdByMemberId.get(id)),
    treeRows,
    joinContractsAttributed,
  );
}

/**
 * 누적 walk 맵 기준 구좌 분할.
 * - walk에 있으면 walk split SSOT.
 * - walk에 없어도 승급 threshold가 있으면 순서일(해피콜 우선) 기준으로 분할.
 *   (고객노드 재매핑으로 walk 귀속이 다른 멤버로 간 직접매출 계약 등)
 * - threshold도 없으면 전량 승격 전(30만).
 */
export function resolvePromotionUnitSplit(
  contract: PromotionOrderContractRef & { unit_count: number },
  walkSplitByContractId?: Map<string, PromotionUnitSplit> | null,
  threshold?: SalesMemberPromotionThreshold | null,
): PromotionUnitSplit {
  const total = Math.max(0, contract.unit_count ?? 0);
  if (total === 0) {
    return { prePromotionUnits: 0, postPromotionUnits: 0 };
  }
  const fromWalk = walkSplitByContractId?.get(contract.id);
  if (fromWalk) {
    if (fromWalk.prePromotionUnits + fromWalk.postPromotionUnits === total) {
      return fromWalk;
    }
    const pre = Math.min(total, Math.max(0, fromWalk.prePromotionUnits));
    return { prePromotionUnits: pre, postPromotionUnits: total - pre };
  }
  if (threshold) {
    return splitContractUnitsByPromotionThreshold(contract, threshold);
  }
  return { prePromotionUnits: total, postPromotionUnits: 0 };
}

/** 정산 계약이 walk에 없을 때 표시용 audit 행 */
export function promotionCommissionSplitForNonWalkContract(params: {
  contractId: string;
  contractCode: string;
  unitCount: number;
  /** walk 밖이지만 승급 threshold로 단가를 판정한 경우 */
  threshold?: SalesMemberPromotionThreshold | null;
  contract?: PromotionOrderContractRef;
}): PromotionCommissionSplit {
  const units = Math.max(0, params.unitCount);
  if (params.threshold && params.contract) {
    const split = splitContractUnitsByPromotionThreshold(
      { ...params.contract, unit_count: units },
      params.threshold,
    );
    const promotionReason = promotionReasonFromThresholdSplit(
      params.contractId,
      split,
      params.threshold,
    );
    const commissionPerUnit: 300_000 | 400_000 =
      split.postPromotionUnits > 0 && split.prePromotionUnits === 0
        ? PROMOTION_LEADER_COMMISSION_PER_UNIT
        : PROMOTION_SALES_COMMISSION_PER_UNIT;
    return {
      contractId: params.contractId,
      contractCode: params.contractCode,
      unitCount: units,
      cumulativeUnitsBefore: 0,
      cumulativeUnitsAfter: 0,
      isPromotionContract: promotionReason === 'PROMOTION_CONTRACT',
      commissionPerUnit,
      promotionReason,
      prePromotionUnits: split.prePromotionUnits,
      postPromotionUnits: split.postPromotionUnits,
    };
  }
  return {
    contractId: params.contractId,
    contractCode: params.contractCode,
    unitCount: units,
    cumulativeUnitsBefore: 0,
    cumulativeUnitsAfter: 0,
    isPromotionContract: false,
    commissionPerUnit: PROMOTION_SALES_COMMISSION_PER_UNIT,
    promotionReason: 'NOT_JOIN_CONTRACT',
    prePromotionUnits: units,
    postPromotionUnits: 0,
  };
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

export type LeaderPromotionEventInsertRow = {
  member_id: string;
  previous_parent_id: string | null;
  threshold_contract_id: string;
  threshold_join_date: string;
};

/**
 * 더블업 반영 승급 인정 walk(20구좌) 기준으로 리더 승급 이벤트·직급 반영 후보를 수집한다.
 */
export function collectLeaderPromotionApplyCandidates(params: {
  treeRows: OrgTreeRow[];
  joinAttributed: AttributedJoinContractRow[];
  members: ReadonlyArray<{ id: string; rank: RankType; external_id?: string | null }>;
  parentByChild: ReadonlyMap<string, string | null>;
  minUnits?: number;
}): {
  thresholds: Map<string, SalesMemberPromotionThreshold | null>;
  rankUpMemberIds: string[];
  eventRows: LeaderPromotionEventInsertRow[];
} {
  const minUnits = params.minUnits ?? LEADER_PROMOTION_MIN_UNITS;
  const thresholds = computeLeaderPromotionThresholds(
    params.treeRows,
    params.joinAttributed,
    params.members,
    minUnits,
  );
  const rankUpMemberIds: string[] = [];
  const eventRows: LeaderPromotionEventInsertRow[] = [];

  for (const m of params.members) {
    if (isCustomerVirtualOrgMember(m.external_id)) continue;
    if (m.rank !== '영업사원' && m.rank !== '리더') continue;
    const th = thresholds.get(m.id) ?? null;
    if (!th) continue;
    if (m.rank === '영업사원') {
      rankUpMemberIds.push(m.id);
    }
    eventRows.push({
      member_id: m.id,
      previous_parent_id: params.parentByChild.get(m.id) ?? null,
      threshold_contract_id: th.threshold_contract_id,
      threshold_join_date: th.threshold_join_date,
    });
  }

  return { thresholds, rankUpMemberIds, eventRows };
}

/**
 * 정책 승급(leader_promotion_events)이 있으나 현재 더블업 인정 walk가 20 미만인 멤버.
 * (규칙 변경·잘못된 승급 소급 보정용 — 이벤트가 없는 수동 리더는 건드리지 않는다.)
 */
export function collectLeaderPromotionDemotionMemberIds(params: {
  treeRows: OrgTreeRow[];
  joinAttributed: AttributedJoinContractRow[];
  promotionEventMemberIds: ReadonlySet<string>;
  members: ReadonlyArray<{ id: string; rank: RankType; external_id?: string | null }>;
  minUnits?: number;
}): string[] {
  if (params.promotionEventMemberIds.size === 0) return [];
  const thresholds = computeLeaderPromotionThresholds(
    params.treeRows,
    params.joinAttributed,
    params.members,
    params.minUnits ?? LEADER_PROMOTION_MIN_UNITS,
  );
  const out: string[] = [];
  for (const m of params.members) {
    if (!params.promotionEventMemberIds.has(m.id)) continue;
    if (isCustomerVirtualOrgMember(m.external_id)) continue;
    if (m.rank !== '영업사원' && m.rank !== '리더') continue;
    if (thresholds.get(m.id)) continue;
    out.push(m.id);
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

function countsAsSubtreeCenterChief(
  memberId: string,
  rankById: Map<string, RankType>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): boolean {
  if (rankById.get(memberId) !== '센터장') return false;
  if (externalIdByMemberId && isCustomerVirtualOrgMember(externalIdByMemberId.get(memberId))) {
    return false;
  }
  return true;
}

/**
 * 산하(본인 제외)에 rank가 '센터장'인 멤버가 DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS 이상이면
 * 해당 멤버(현재 직급이 센터장인 경우)를 사업본부장으로 승격 대상으로 본다.
 *
 * `externalIdByMemberId`가 주어지면 `customer:*` 가상 노드는 산하 센터장 수에 포함하지 않는다.
 */
export function computeDivisionHeadPromotionMemberIds(
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): string[] {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const out: string[] = [];

  for (const [memberId, rank] of rankById) {
    if (rank !== '센터장') continue;

    const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
    let centerChiefCount = 0;
    for (const sid of subtree) {
      if (sid === memberId) continue;
      if (countsAsSubtreeCenterChief(sid, rankById, externalIdByMemberId)) centerChiefCount++;
    }
    if (centerChiefCount >= DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS) {
      out.push(memberId);
    }
  }

  return out;
}

/**
 * 산하 유효 센터장이 DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS 미만인 사업본부장 → 센터장 강등 대상.
 */
export function computeDivisionHeadDemotionMemberIds(
  treeRows: OrgTreeRow[],
  rankById: Map<string, RankType>,
  externalIdByMemberId?: ReadonlyMap<string, string | null | undefined>,
): string[] {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const out: string[] = [];

  for (const [memberId, rank] of rankById) {
    if (rank !== '사업본부장') continue;

    const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
    let centerChiefCount = 0;
    for (const sid of subtree) {
      if (sid === memberId) continue;
      if (countsAsSubtreeCenterChief(sid, rankById, externalIdByMemberId)) centerChiefCount++;
    }
    if (centerChiefCount < DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS) {
      out.push(memberId);
    }
  }

  return out;
}
