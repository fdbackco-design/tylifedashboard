import type {
  MonthlySettlementInsert,
  SettlementRule,
  ContractSettlementItem,
  RollupItem,
  RollupContractItem,
  SettlementCalculationDetail,
  LeaderPromotionSettlementDetail,
} from '../types/settlement';
import type { RankType, OrgTreeNode, OrgTreeRow } from '../types/organization';
import type { AttributedJoinContractRow, PromotionOrderContractRef, PromotionUnitSplit, PromotionCommissionSplit, SalesMemberPromotionThreshold } from './leader-promotion';
import {
  contractJoinOrderYmd,
  isLeaderMaintenanceBonusEligible,
  subtreeJoinUnitsForLeaderMaintenanceInWindow,
  subtreeJoinUnitsJoinOnlyAsOf,
  rollupEligibleUnitsForParentSubtree,
  prePromotionUnitsForPreviousLeaderRollup,
  resolvePromotionUnitSplit,
  promotionCommissionSplitForNonWalkContract,
} from './leader-promotion';
import {
  calculateGroupBonusForMember,
  type GroupBonusContractInput,
} from './group-bonus';
import type { Contract } from '../types/contract';
import { RANK_ORDER } from '../types/organization';
import {
  BASE_AMOUNT_PER_UNIT,
  DEFAULT_COMMISSION_BY_RANK,
  DEFAULT_INCENTIVE_CONFIG,
  commissionPenaltyWonForItemName,
} from './constants';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { getHappycallWindowForYearMonth } from '@/lib/settlement/settlement-eligibility-v2';

function monthEndDate(yearMonth: string): string {
  // 'YYYY-MM' -> 'YYYY-MM-DD' (해당 월 말일)
  const [y, m] = yearMonth.split('-').map(Number);
  const end = new Date(y, m, 0); // day 0 of next month = last day of this month
  return `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────
// 정산 규칙 조회 헬퍼
// ─────────────────────────────────────────────

/**
 * 특정 직급·날짜 기준 적용 중인 정산 규칙을 찾는다.
 * effective_until이 null이거나 date보다 이후인 규칙 중 가장 최근 것.
 */
export function findActiveRule(
  rules: SettlementRule[],
  rank: RankType,
  date: string, // 'YYYY-MM-DD'
): SettlementRule | undefined {
  return rules
    .filter(
      (r) =>
        r.rank === rank &&
        r.effective_from <= date &&
        (r.effective_until === null || r.effective_until >= date),
    )
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}

function getActiveRuleOrFallback(
  rules: SettlementRule[],
  rank: RankType,
  date: string, // 'YYYY-MM-DD'
): SettlementRule {
  const active = findActiveRule(rules, rank, date);
  if (active) {
    // 요구: /admin/settlement에서 "리더" 기본 수당은 구좌당 40만원을 보장한다.
    // DB(settlement_rules)에 더 낮은 값이 들어있어도, 화면/계산이 40만원 아래로 내려가지 않도록 방어한다.
    if (rank === '리더') {
      const min = DEFAULT_COMMISSION_BY_RANK['리더'] ?? 0;
      return { ...active, commission_per_unit: Math.max(active.commission_per_unit ?? 0, min) };
    }
    return active;
  }

  const commission =
    (rank === '사업본부장' ? 600_000 : (DEFAULT_COMMISSION_BY_RANK[rank] ?? 0));
  const incentive = DEFAULT_INCENTIVE_CONFIG[rank] ?? null;

  return {
    id: `fallback:${rank}`,
    rank,
    base_amount_per_unit: BASE_AMOUNT_PER_UNIT,
    commission_per_unit: commission,
    incentive_unit_threshold: incentive?.threshold ?? null,
    incentive_amount: incentive?.amount ?? null,
    effective_from: '1900-01-01',
    effective_until: null,
    note: 'fallback',
    created_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// 직급 간 롤업 차액 계산
// ─────────────────────────────────────────────

/**
 * 상위 직급이 하위 직급으로부터 받는 구좌당 롤업 차액.
 * 예: 리더(400k) - 영업사원(300k) = 100k
 */
export function getRollupAmountPerUnit(
  upperRank: RankType,
  lowerRank: RankType,
  rules: SettlementRule[],
  date: string,
): number {
  const upperRule = getActiveRuleOrFallback(rules, upperRank, date);
  const lowerRule = getActiveRuleOrFallback(rules, lowerRank, date);

  const diff = upperRule.commission_per_unit - lowerRule.commission_per_unit;
  return Math.max(0, diff);
}

// ─────────────────────────────────────────────
// 개인 직접 계약 정산 계산
// ─────────────────────────────────────────────

function calcDirectContracts(
  contracts: Contract[],
  rule: SettlementRule,
): { items: ContractSettlementItem[]; total: number } {
  const items: ContractSettlementItem[] = contracts.map((c) => {
    const base = c.unit_count * rule.commission_per_unit;
    const penalty = commissionPenaltyWonForItemName((c as { item_name?: string }).item_name, c.unit_count);
    return {
      contract_id: c.id,
      contract_code: c.contract_code,
      unit_count: c.unit_count,
      commission_per_unit: rule.commission_per_unit,
      subtotal: base - penalty,
    };
  });

  const total = items.reduce((sum, i) => sum + i.subtotal, 0);
  return { items, total };
}

// ─────────────────────────────────────────────
// 유지 장려금 계산
// ─────────────────────────────────────────────

function calcIncentive(
  rule: SettlementRule,
  totalUnitCount: number,
): number {
  if (
    rule.incentive_unit_threshold === null ||
    rule.incentive_amount === null
  ) {
    return 0;
  }
  return totalUnitCount >= rule.incentive_unit_threshold
    ? rule.incentive_amount
    : 0;
}

// ─────────────────────────────────────────────
// 롤업 계산 (산하 하위 조직)
// ─────────────────────────────────────────────

/**
 * node의 직접 계약 구좌를 수집하고, 상위 직급에게 롤업 차액을 계산.
 * flatContracts: 멤버 ID → 해당 멤버의 정산 대상 계약 목록
 */
function collectSubordinateUnits(
  node: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
): number {
  const directUnits = (contractsByMember.get(node.id) ?? []).reduce(
    (sum, c) => sum + c.unit_count,
    0,
  );
  const childUnits = node.children.reduce(
    (sum, child) => sum + collectSubordinateUnits(child, contractsByMember),
    0,
  );
  return directUnits + childUnits;
}

/**
 * 상위 멤버(member)의 롤업 수당 계산.
 * - 하위 직급 계약이 완료될 때마다 (상위 수당 - 하위 수당) 차액을 받음
 * - 직접 하위 자녀의 계약만 처리 (손자는 자녀가 처리)
 */
type SubtreeContractWithOwner = {
  contract: Contract;
  ownerMemberId: string;
  ownerName: string;
  ownerRank: RankType;
};

function calcRollupItems(
  node: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
  rules: SettlementRule[],
  yearMonth: string,
): { items: RollupItem[]; total: number; contractItems: RollupContractItem[] } {
  const refDate = monthEndDate(yearMonth);
  const items: RollupItem[] = [];
  const contractItems: RollupContractItem[] = [];

  for (const child of node.children) {
    // 롤업은 하위 라인 전체(subtree) 계약에 대해 발생한다.
    const childContractsWithOwner = collectSubtreeContractsWithOwner(child, contractsByMember);
    const childUnits = childContractsWithOwner.reduce((s, x) => s + x.contract.unit_count, 0);

    if (childUnits === 0) continue;

    const rollupPerUnit = getRollupAmountPerUnit(
      node.rank,
      child.rank,
      rules,
      refDate,
    );

    if (rollupPerUnit > 0) {
      items.push({
        from_member_id: child.id,
        from_member_name: child.name,
        from_rank: child.rank,
        unit_count: childUnits,
        rollup_amount_per_unit: rollupPerUnit,
        subtotal: childUnits * rollupPerUnit,
      });

      // 계약 단위 근거 캡처. 산식/총합 변경 없이 동일 계산을 계약별로 분해해 저장만 한다.
      for (const { contract: c, ownerMemberId, ownerName, ownerRank } of childContractsWithOwner) {
        contractItems.push({
          contract_id: c.id,
          contract_code: c.contract_code,
          from_member_id: child.id,
          from_member_name: child.name,
          from_rank: child.rank,
          effective_sales_member_id: ownerMemberId,
          effective_sales_member_name: ownerName,
          effective_sales_member_rank: ownerRank,
          unit_count: c.unit_count,
          rollup_amount_per_unit: rollupPerUnit,
          subtotal: rollupPerUnit * c.unit_count,
          included_reason: 'direct_child',
        });
      }
    }
  }

  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return { items, total, contractItems };
}

// ─────────────────────────────────────────────
// 리더 승격(산하 가입 20구좌) — 영업사원 직접/롤업 단가 분기
// ─────────────────────────────────────────────

/** 정산 API에서 한 번 구성해 전달(산하 가입 계약·트리·승격 계약 맵) */
export interface LeaderSettlementOpts {
  treeRows: OrgTreeRow[];
  /** 영업사원별: 산하 가입 누적 20구좌를 채운 '승격 계약'(가입일+id). 날짜만으로는 같은 일자 계약을 구분할 수 없음 */
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>;
  joinOnlyAttributed: AttributedJoinContractRow[];
  /** 정산 기준월의 종료일(보통 25일, YYYY-MM-DD) */
  settlementEndDate: string;
  /** 리더 유지장려금(1회성) 지급 여부: 지급된 멤버는 해당 보너스를 다시 받지 않음 */
  leaderMaintenanceBonusAlreadyPaidByMemberId?: Map<string, boolean>;
  /** 정책 승격자의 '승격 전 상위 리더' (재계산 안정화용) */
  previousLeaderByPromotedMemberId?: Map<string, string | null>;
  /**
   * 멤버 id → 리더 단가 적용 기준 시각(ISO). organization_members.leader_rank_effective_at에서 채운다.
   * 해당 시각 이후(≥) 생성된 계약은 threshold와 무관하게 리더 단가 후보가 된다.
   */
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>;
  /**
   * 2026-06 한정 그룹 보너스(2구좌당 5만원) 계산용 입력.
   * - 정산월이 2026-06이 아니면 무시된다.
   * - 보너스 적용 기간/그룹화 규칙은 `lib/settlement/group-bonus.ts` 참고.
   */
  groupBonusContracts?: ReadonlyArray<GroupBonusContractInput>;
  /**
   * 멤버별 incentive_amount 고정 override (settlement_statement_overrides.bonus_amount).
   * 재계산 시에도 유지된다.
   */
  incentiveAmountOverrideByMemberId?: Map<string, number>;
  /** 멤버 id → 조직 트리 노드(승격 후 HQ 직속 등 이전 리더 롤업 보강용) */
  orgNodeByMemberId?: Map<string, OrgTreeNode>;
  /**
   * joinAttributed walk 기준 계약별 승격 전/후 구좌 (수당 SSOT).
   */
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>;
  /** 검증용: 산하 전체 가입 누적 walk audit */
  promotionCommissionAuditByMemberId?: Map<string, PromotionCommissionSplit[]>;
}

const LEADER_MAINTENANCE_BONUS_WON = 1_000_000;

function commissionPerUnitForDirectContract(
  memberId: string,
  dbRank: RankType,
  contract: PromotionOrderContractRef & { unit_count?: number },
  rules: SettlementRule[],
  refDate: string,
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
): number {
  if (dbRank === '본사') return 0;

  const effectiveAtRaw = leaderRankEffectiveAtByMemberId?.get(memberId) ?? null;
  const effectiveAt = (effectiveAtRaw ?? '').trim();
  if (dbRank === '리더' && effectiveAt) {
    const cAt = (contract.created_at ?? '').trim();
    if (cAt && cAt >= effectiveAt) {
      return getActiveRuleOrFallback(rules, '리더', refDate).commission_per_unit;
    }
  }

  if (dbRank === '영업사원' || dbRank === '리더') {
    const walk = promotionUnitSplitByMemberId?.get(memberId);
    const units = Math.max(0, contract.unit_count ?? 1);
    const split = resolvePromotionUnitSplit({ ...contract, unit_count: units }, walk);
    if (split.postPromotionUnits > 0 && split.prePromotionUnits === 0) {
      return getActiveRuleOrFallback(rules, '리더', refDate).commission_per_unit;
    }
    return getActiveRuleOrFallback(rules, '영업사원', refDate).commission_per_unit;
  }

  return getActiveRuleOrFallback(rules, dbRank, refDate).commission_per_unit;
}

function contractPromotionRef(c: Contract): PromotionOrderContractRef {
  return {
    id: c.id,
    join_date: c.join_date,
    happy_call_at: c.happy_call_at ?? null,
    invoice_registered_at: (c as { invoice_registered_at?: string | null }).invoice_registered_at ?? null,
    created_at: (c as { created_at?: string | null }).created_at ?? null,
  };
}

function calcDirectContractsWithLeaderPromotion(
  eligible: Contract[],
  member: { id: string; rank: RankType },
  rules: SettlementRule[],
  refDate: string,
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>,
  promotionCommissionAuditByMemberId?: Map<string, PromotionCommissionSplit[]>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
): { items: ContractSettlementItem[]; total: number } {
  const salesRate = getActiveRuleOrFallback(rules, '영업사원', refDate).commission_per_unit;
  const leaderRate = getActiveRuleOrFallback(rules, '리더', refDate).commission_per_unit;

  const auditByContractId = new Map<string, PromotionCommissionSplit>();
  const memberAudit = promotionCommissionAuditByMemberId?.get(member.id) ?? [];
  for (const row of memberAudit) {
    auditByContractId.set(row.contractId, row);
  }

  const items: ContractSettlementItem[] = eligible.map((c) => {
    const originMemberId = (c as any).__attributed_origin_member_id as string | undefined;
    const originRank = (c as any).__attributed_origin_rank as RankType | undefined;
    const rateMemberId = originMemberId ?? member.id;
    const dbRank = originRank ?? member.rank;
    const ref = contractPromotionRef(c);
    const walk =
      promotionUnitSplitByMemberId?.get(rateMemberId) ??
      promotionUnitSplitByMemberId?.get(member.id);

    let commissionPerUnit: number;
    let base: number;
    let auditRow =
      auditByContractId.get(c.id) ??
      promotionCommissionAuditByMemberId?.get(rateMemberId)?.find((r) => r.contractId === c.id);

    const effectiveAtRaw = leaderRankEffectiveAtByMemberId?.get(rateMemberId) ?? null;
    const effectiveAt = (effectiveAtRaw ?? '').trim();
    if (dbRank === '리더' && effectiveAt) {
      const cAt = (ref.created_at ?? '').trim();
      if (cAt && cAt >= effectiveAt) {
        commissionPerUnit = leaderRate;
        base = c.unit_count * commissionPerUnit;
        const penalty = commissionPenaltyWonForItemName((c as { item_name?: string }).item_name, c.unit_count);
        return {
          contract_id: c.id,
          contract_code: c.contract_code,
          unit_count: c.unit_count,
          commission_per_unit: commissionPerUnit,
          subtotal: base - penalty,
        };
      }
    }

    if (dbRank === '영업사원' || dbRank === '리더') {
      const { prePromotionUnits, postPromotionUnits } = resolvePromotionUnitSplit(
        { ...ref, unit_count: c.unit_count },
        walk,
      );
      base = prePromotionUnits * salesRate + postPromotionUnits * leaderRate;
      commissionPerUnit =
        c.unit_count > 0 ? Math.round(base / c.unit_count) : salesRate;
      if (!auditRow) {
        auditRow = promotionCommissionSplitForNonWalkContract({
          contractId: c.id,
          contractCode: c.contract_code,
          unitCount: c.unit_count,
        });
      }
    } else {
      commissionPerUnit = commissionPerUnitForDirectContract(
        rateMemberId,
        dbRank,
        { ...ref, unit_count: c.unit_count },
        rules,
        refDate,
        promotionUnitSplitByMemberId,
        leaderRankEffectiveAtByMemberId,
      );
      base = c.unit_count * commissionPerUnit;
    }

    const penalty = commissionPenaltyWonForItemName((c as { item_name?: string }).item_name, c.unit_count);
    return {
      contract_id: c.id,
      contract_code: c.contract_code,
      unit_count: c.unit_count,
      commission_per_unit: commissionPerUnit,
      subtotal: base - penalty,
      promotion_cumulative_units_before: auditRow?.cumulativeUnitsBefore,
      promotion_cumulative_units_after: auditRow?.cumulativeUnitsAfter,
      promotion_is_promotion_contract: auditRow?.isPromotionContract,
      promotion_reason: auditRow?.promotionReason,
    };
  });
  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return { items, total };
}

function collectSubtreeContractsWithOwner(
  n: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
): SubtreeContractWithOwner[] {
  const out: SubtreeContractWithOwner[] = [];
  const stack: OrgTreeNode[] = [n];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of contractsByMember.get(cur.id) ?? []) {
      out.push({ contract: c, ownerMemberId: cur.id, ownerName: cur.name, ownerRank: cur.rank });
    }
    for (const ch of cur.children ?? []) stack.push(ch);
  }
  return out;
}

function calcRollupItemsWithLeaderPromotion(
  node: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
  rules: SettlementRule[],
  yearMonth: string,
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>,
  previousLeaderByPromotedMemberId?: Map<string, string | null>,
  leaderRankEffectiveAtByMemberId?: Map<string, string | null>,
  orgNodeByMemberId?: Map<string, OrgTreeNode>,
  promotionUnitSplitByMemberId?: Map<string, Map<string, PromotionUnitSplit>>,
): { items: RollupItem[]; total: number; contractItems: RollupContractItem[] } {
  const refDate = monthEndDate(yearMonth);
  const items: RollupItem[] = [];
  const contractItems: RollupContractItem[] = [];
  const nodeThreshold = promotionThresholdByMemberId.get(node.id) ?? null;

  const directChildIdSet = new Set((node.children ?? []).map((c) => c.id));

  for (const child of node.children) {
    // 롤업은 자식 subtree 전체 계약에 대해 계산해야 한다.
    const childThreshold = promotionThresholdByMemberId.get(child.id) ?? null;

    // 월 중 정책 승격:
    // - childThreshold: 자식이 승격한 이후 계약은 부모(node) 롤업에서 제외(기존 상위가 못 받음).
    // - nodeThreshold: node 본인이 승격하기 전 산하 계약은 node 롤업에서 제외(이전 상위 리더 귀속).
    const childContractsAllWithOwner = collectSubtreeContractsWithOwner(child, contractsByMember);

    let childUnits = 0;
    let subtotal = 0;
    const localContractItems: RollupContractItem[] = [];
    for (const { contract: c, ownerMemberId, ownerName, ownerRank } of childContractsAllWithOwner) {
      const ref = contractPromotionRef(c);
      const eligibleUnits = rollupEligibleUnitsForParentSubtree(
        { ...ref, unit_count: c.unit_count },
        nodeThreshold,
        childThreshold,
        promotionUnitSplitByMemberId,
        node.id,
        child.id,
      );
      if (eligibleUnits <= 0) continue;

      childUnits += eligibleUnits;
      const upper = commissionPerUnitForDirectContract(
        node.id,
        node.rank,
        contractPromotionRef(c),
        rules,
        refDate,
        promotionUnitSplitByMemberId,
        leaderRankEffectiveAtByMemberId,
      );
      // 산식 변경 금지: lower 는 직속 자식(child.id / child.rank) 기준 그대로 계산한다.
      // (ownerMemberId/ownerRank 는 표시용 메타로만 사용)
      const lower = commissionPerUnitForDirectContract(
        child.id,
        child.rank,
        contractPromotionRef(c),
        rules,
        refDate,
        promotionUnitSplitByMemberId,
        leaderRankEffectiveAtByMemberId,
      );
      const diff = Math.max(0, upper - lower);
      const sub = diff * eligibleUnits;
      subtotal += sub;
      if (sub > 0) {
        localContractItems.push({
          contract_id: c.id,
          contract_code: c.contract_code,
          from_member_id: child.id,
          from_member_name: child.name,
          from_rank: child.rank,
          effective_sales_member_id: ownerMemberId,
          effective_sales_member_name: ownerName,
          effective_sales_member_rank: ownerRank,
          unit_count: eligibleUnits,
          rollup_amount_per_unit: diff,
          subtotal: sub,
          included_reason: childThreshold ? 'direct_child_pre_promotion' : 'direct_child',
        });
      }
    }

    if (childUnits === 0) continue;

    if (subtotal > 0) {
      const avg = childUnits ? subtotal / childUnits : 0;
      items.push({
        from_member_id: child.id,
        from_member_name: child.name,
        from_rank: child.rank,
        unit_count: childUnits,
        rollup_amount_per_unit: avg,
        subtotal,
      });
      contractItems.push(...localContractItems);
    }
  }

  // 승격 후 본사 직속으로 재배치된 멤버도, 승격 전 계약에 대해서는 "이전 리더"에게 롤업이 발생해야 한다.
  // organization_edges는 현재 parent만 가지므로, 재계산을 여러 번 눌러도 결과가 변하지 않게
  // previousLeaderByPromotedMemberId(이력)을 기반으로 추가 롤업 항목을 만든다.
  if (previousLeaderByPromotedMemberId) {
    for (const [promotedId, leaderId] of previousLeaderByPromotedMemberId) {
      if (!leaderId || leaderId !== node.id) continue;
      // 아직 현재 트리에서 promotedId가 node의 직접 자식으로 연결돼 있으면,
      // 위의 일반 롤업 계산이 이미 승격 전 계약을 포함해 계산한다.
      // 이 경우 보강 롤업을 추가하면 이중 계산이 되므로 스킵한다.
      if (directChildIdSet.has(promotedId)) continue;
      const th = promotionThresholdByMemberId.get(promotedId) ?? null;
      if (!th) continue;
      const promotedNode = orgNodeByMemberId?.get(promotedId) ?? null;
      const promotedContractsAllWithOwner: SubtreeContractWithOwner[] = promotedNode
        ? collectSubtreeContractsWithOwner(promotedNode, contractsByMember)
        : (contractsByMember.get(promotedId) ?? []).map((c) => ({
            contract: c,
            ownerMemberId: promotedId,
            ownerName: '(승격자)',
            ownerRank: '영업사원' as RankType,
          }));
      const preWithOwner = promotedContractsAllWithOwner;
      let units = 0;
      let subtotal = 0;
      const localContractItems: RollupContractItem[] = [];
      for (const { contract: c, ownerMemberId, ownerName, ownerRank } of preWithOwner) {
        const ref = contractPromotionRef(c);
        const eligibleUnits = prePromotionUnitsForPreviousLeaderRollup(
          { ...ref, unit_count: c.unit_count },
          th,
          promotionUnitSplitByMemberId,
          promotedId,
        );
        if (eligibleUnits <= 0) continue;

        units += eligibleUnits;
        const upper = commissionPerUnitForDirectContract(
          node.id,
          node.rank,
          contractPromotionRef(c),
          rules,
          refDate,
          promotionUnitSplitByMemberId,
          leaderRankEffectiveAtByMemberId,
        );
        const lower = commissionPerUnitForDirectContract(
          promotedId,
          // 현재 DB rank가 리더로 바뀌었어도 누적 walk 기준 30/40 분기
          '리더',
          contractPromotionRef(c),
          rules,
          refDate,
          promotionUnitSplitByMemberId,
          leaderRankEffectiveAtByMemberId,
        );
        const diff = Math.max(0, upper - lower);
        const sub = diff * eligibleUnits;
        subtotal += sub;
        if (sub > 0) {
          localContractItems.push({
            contract_id: c.id,
            contract_code: c.contract_code,
            from_member_id: promotedId,
            from_member_name: '(승격자)',
            from_rank: '영업사원',
            effective_sales_member_id: ownerMemberId,
            effective_sales_member_name: ownerName,
            effective_sales_member_rank: ownerRank,
            unit_count: eligibleUnits,
            rollup_amount_per_unit: diff,
            subtotal: sub,
            included_reason: 'previous_leader_pre_promotion',
          });
        }
      }
      if (units === 0) continue;

      if (subtotal > 0) {
        items.push({
          from_member_id: promotedId,
          from_member_name: '(승격자)',
          from_rank: '영업사원',
          unit_count: units,
          rollup_amount_per_unit: units ? subtotal / units : 0,
          subtotal,
        });
        contractItems.push(...localContractItems);
      }
    }
  }

  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return { items, total, contractItems };
}

// ─────────────────────────────────────────────
// 월별 정산 메인 계산
// ─────────────────────────────────────────────

export interface MemberContractMap {
  member: { id: string; name: string; rank: RankType };
  directContracts: Contract[];
}

/**
 * 단일 멤버의 월별 정산을 계산.
 *
 * @param member - 정산 대상 멤버
 * @param directContracts - 멤버가 직접 담당한 정산 대상 계약
 * @param orgNode - 멤버를 루트로 하는 조직 트리 (롤업 계산용)
 * @param contractsByMember - 전체 멤버 ID → 계약 목록 맵 (트리 순회용)
 * @param rules - 현재 적용 중인 정산 규칙 목록
 * @param yearMonth - 'YYYY-MM'
 * @param leaderOpts - 전달 시: 영업사원 리더 승격(산하 가입 20구좌)·25일 유지 장려금 반영
 */
export function calculateMemberSettlement(
  member: { id: string; name: string; rank: RankType },
  directContracts: Contract[],
  orgNode: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
  rules: SettlementRule[],
  yearMonth: string,
  leaderOpts?: LeaderSettlementOpts,
): MonthlySettlementInsert {
  const refDate = monthEndDate(yearMonth);
  const rule = getActiveRuleOrFallback(rules, member.rank, refDate);
  const eligible = directContracts;

  let directItems: ContractSettlementItem[];
  let baseCommission: number;
  let rollupItems: RollupItem[];
  let rollupCommission: number;
  let rollupContractItems: RollupContractItem[];

  const thresholdMap =
    leaderOpts?.promotionThresholdByMemberId ?? new Map<string, SalesMemberPromotionThreshold | null>();
  const leaderEffectiveMap = leaderOpts?.leaderRankEffectiveAtByMemberId;
  const promotionUnitSplitByMemberId = leaderOpts?.promotionUnitSplitByMemberId;
  const promotionCommissionAuditByMemberId = leaderOpts?.promotionCommissionAuditByMemberId;
  const thForMember = thresholdMap.get(member.id) ?? null;
  const hasAttributedOrigin = eligible.some((c) => (c as any).__attributed_origin_member_id != null);
  const useLeaderRates =
    !!leaderOpts &&
    (hasAttributedOrigin ||
      member.rank === '영업사원' ||
      member.rank === '리더' ||
      thForMember !== null);

  if (useLeaderRates) {
    ({ items: directItems, total: baseCommission } = calcDirectContractsWithLeaderPromotion(
      eligible,
      member,
      rules,
      refDate,
      promotionUnitSplitByMemberId,
      promotionCommissionAuditByMemberId,
      leaderEffectiveMap,
    ));
    ({
      items: rollupItems,
      total: rollupCommission,
      contractItems: rollupContractItems,
    } = calcRollupItemsWithLeaderPromotion(
      orgNode,
      contractsByMember,
      rules,
      yearMonth,
      thresholdMap,
      leaderOpts?.previousLeaderByPromotedMemberId,
      leaderEffectiveMap,
      leaderOpts?.orgNodeByMemberId,
      promotionUnitSplitByMemberId,
    ));
  } else {
    ({ items: directItems, total: baseCommission } = calcDirectContracts(eligible, rule));
    ({
      items: rollupItems,
      total: rollupCommission,
      contractItems: rollupContractItems,
    } = calcRollupItems(orgNode, contractsByMember, rules, yearMonth));
  }

  const subordinateUnitCount = collectSubordinateUnits(orgNode, contractsByMember);
  const directUnitCount = eligible.reduce((s, c) => s + c.unit_count, 0);
  const totalUnitCount = directUnitCount + subordinateUnitCount;

  // 규칙장려(calcIncentive)는 UI에서 제거되었고, 유지장려(리더)와 혼동/중복을 유발한다.
  // 따라서 정산 합계에서는 규칙장려를 사용하지 않는다.
  // (필요 시 별도 컬럼/규칙으로 다시 설계)
  const ruleIncentiveAmount = 0;

  let leaderMaintenanceBonus = 0;
  if (leaderOpts && (member.rank === '영업사원' || member.rank === '리더')) {
    const th = leaderOpts.promotionThresholdByMemberId.get(member.id) ?? null;
    const { start_date, end_date } = getHappycallWindowForYearMonth(yearMonth);
    // 유지장려금 집계는 "하위 리더 컷" 규칙을 적용한다.
    // - 자식 노드 중 리더 이상이면 그 노드와 그 후손을 제외 → 해당 리더 본인의 유지장려금 계산에만 잡힘.
    // - 롤업수당 계산(`calcRollupItemsWithLeaderPromotion`)은 별도 함수이고 영향 없음.
    const periodUnits = subtreeJoinUnitsForLeaderMaintenanceInWindow({
      memberId: member.id,
      treeRows: leaderOpts.treeRows,
      joinContractsAttributed: leaderOpts.joinOnlyAttributed,
      startInclusive: start_date,
      endInclusive: end_date,
    });

    // 누적 가입 구좌가 20 이상이면 고정 100만원 1회 지급.
    // (이전 정책의 "20구좌마다 100만원" 누적 산식은 잘못된 구현이었음 — 40구좌라도 100만원 1회)
    // 정책 승격으로 DB rank가 리더로 올라간 경우에도 유지장려금 판정은 영업사원 기준으로 동작해야 한다.
    const eligible = isLeaderMaintenanceBonusEligible({
      memberDbRank: member.rank === '리더' ? '영업사원' : member.rank,
      promotionThreshold: th,
      subtreeJoinUnitsAsOf25: periodUnits,
    });
    leaderMaintenanceBonus = eligible ? LEADER_MAINTENANCE_BONUS_WON : 0;
  }

  // 2026-06 한정 그룹 보너스 (2구좌당 5만원, 가입일+고객명+담당사원 그룹화)
  // - 직급 무관, 1구좌 그룹은 0원
  // - 정산월이 2026-06이 아니거나 입력이 없으면 0원
  let groupBonus = leaderOpts?.groupBonusContracts
    ? calculateGroupBonusForMember(member.id, leaderOpts.groupBonusContracts, yearMonth)
    : 0;

  let bonusAmountCombined = ruleIncentiveAmount + leaderMaintenanceBonus + groupBonus;
  let totalAmount = baseCommission + rollupCommission + leaderMaintenanceBonus + groupBonus;

  const incentiveOverride = leaderOpts?.incentiveAmountOverrideByMemberId?.get(member.id);
  if (incentiveOverride != null && Number.isFinite(incentiveOverride)) {
    bonusAmountCombined = Math.round(incentiveOverride);
    groupBonus = Math.max(0, bonusAmountCombined - ruleIncentiveAmount - leaderMaintenanceBonus);
    totalAmount = baseCommission + rollupCommission + bonusAmountCombined;
  }

  // 수동 예외 차감 규칙은 사용하지 않는다.
  const manualAdjustment = 0;
  // 가입 구좌가 0이면 합계는 항상 0원으로 고정(음수 방지)
  if (totalUnitCount === 0) totalAmount = 0;

  let leaderPromotion: LeaderPromotionSettlementDetail | null = null;
  if (leaderOpts) {
    const th = leaderOpts.promotionThresholdByMemberId.get(member.id) ?? null;
    const subtreeJoinEnd = subtreeJoinUnitsJoinOnlyAsOf(
      member.id,
      leaderOpts.treeRows,
      leaderOpts.joinOnlyAttributed,
      leaderOpts.settlementEndDate.slice(0, 10),
    );
    const ruSales = getActiveRuleOrFallback(rules, '영업사원', refDate).commission_per_unit;
    const ruLeader = getActiveRuleOrFallback(rules, '리더', refDate).commission_per_unit;
    let label = `${member.rank} 기준`;
    let applied: number | null = getActiveRuleOrFallback(rules, member.rank, refDate).commission_per_unit;
    if (member.rank === '영업사원' || member.rank === '리더') {
      const walk = leaderOpts.promotionUnitSplitByMemberId?.get(member.id);
      const hasBefore = eligible.some((c) => {
        const split = walk?.get(c.id);
        return !split || split.postPromotionUnits === 0;
      });
      const hasAfter = eligible.some((c) => {
        const split = walk?.get(c.id);
        return split != null && split.postPromotionUnits > 0;
      });
      if (hasBefore && hasAfter) {
        label = `${(ruSales / 10_000).toFixed(0)}만/${(ruLeader / 10_000).toFixed(0)}만 혼합(승격 계약 전후)`;
        applied = null;
      } else if (hasAfter && !hasBefore) {
        label = `${(ruLeader / 10_000).toFixed(0)}만원/구좌(리더)`;
        applied = ruLeader;
      } else {
        label = `${(ruSales / 10_000).toFixed(0)}만원/구좌(영업사원)`;
        applied = ruSales;
      }
    }
    leaderPromotion = {
      db_rank: member.rank,
      effective_is_leader:
        (member.rank === '영업사원' || member.rank === '리더') &&
        (promotionCommissionAuditByMemberId?.get(member.id)?.some((r) => r.promotionReason === 'AFTER_PROMOTION') ??
          false),
      leader_promotion_first_join_date:
        member.rank === '영업사원' || member.rank === '리더' ? th?.threshold_join_date ?? null : null,
      leader_promotion_threshold_contract_id:
        member.rank === '영업사원' || member.rank === '리더' ? th?.threshold_contract_id ?? null : null,
      subtree_join_units_join_status_as_of_end: subtreeJoinEnd,
      commission_rate_label: label,
      applied_commission_per_unit: applied,
      rule_incentive_amount: ruleIncentiveAmount,
      leader_maintenance_bonus_amount: leaderMaintenanceBonus,
      leader_maintenance_bonus_eligible: leaderMaintenanceBonus > 0,
      promotion_commission_audit: promotionCommissionAuditByMemberId?.get(member.id) ?? undefined,
    };
  }

  // 정합성 검증(소수점/반올림 외 오차 0원이 정상). 운영 환경 노이즈를 막기 위해 1원 허용.
  // 오차 발생 시 콘솔에 경고만 남기고 계산 결과는 절대 변경하지 않는다.
  const rollupContractItemsTotal = rollupContractItems.reduce((s, x) => s + x.subtotal, 0);
  if (Math.abs(rollupContractItemsTotal - rollupCommission) > 1) {
    console.warn('[rollup-contract-items][mismatch]', {
      member_id: member.id,
      year_month: yearMonth,
      rollup_commission: rollupCommission,
      rollup_contract_items_total: rollupContractItemsTotal,
      rollup_items_total: rollupItems.reduce((s, i) => s + i.subtotal, 0),
      delta: rollupContractItemsTotal - rollupCommission,
    });
  }

  const detail: SettlementCalculationDetail = {
    year_month: yearMonth,
    member_id: member.id,
    member_name: member.name,
    rank: member.rank,
    rule_id: rule.id,
    direct_contracts: directItems,
    rollup_items: rollupItems,
    rollup_contract_items: rollupContractItems,
    incentive_applied: bonusAmountCombined > 0,
    incentive_threshold: null,
    incentive_amount: bonusAmountCombined,
    leader_promotion: leaderPromotion,
    group_bonus_amount: groupBonus,
    manual_adjustment_won: manualAdjustment !== 0 ? manualAdjustment : undefined,
    manual_adjustment_reason: manualAdjustment !== 0 ? '고객 김동건 정산 예외(-60만원)' : undefined,
  };

  return {
    year_month: yearMonth,
    member_id: member.id,
    rank: member.rank,
    direct_contract_count: eligible.length,
    direct_unit_count: directUnitCount,
    subordinate_unit_count: subordinateUnitCount,
    total_unit_count: totalUnitCount,
    base_commission: baseCommission,
    rollup_commission: rollupCommission,
    incentive_amount: bonusAmountCombined,
    total_amount: totalAmount,
    calculation_detail: detail,
    is_finalized: false,
  };
}

// ─────────────────────────────────────────────
// 조직 트리 빌더 (flat rows → 재귀 트리)
// ─────────────────────────────────────────────

export function buildOrgTree(rows: OrgTreeRow[]): OrgTreeNode[] {
  const nodeMap = new Map<string, OrgTreeNode>();
  const parentById = new Map<string, string | null>();

  for (const row of rows) {
    nodeMap.set(row.id, {
      id: row.id,
      name: row.name,
      rank: row.rank,
      phone: null,
      email: null,
      external_id: null,
      is_active: true,
      created_at: '',
      updated_at: '',
      children: [],
    });
    parentById.set(row.id, row.parent_id ?? null);
  }

  const roots: OrgTreeNode[] = [];

  for (const row of rows) {
    const node = nodeMap.get(row.id)!;
    if (row.parent_id === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(row.parent_id);
      if (parent) {
        // cycle 방어: row.parent_id가 row.id의 조상 체인에 이미 있으면 연결하지 않는다.
        // (DB에 순환 엣지가 있어도 UI가 무한 재귀로 멈추지 않게)
        let cur: string | null = row.parent_id;
        let isCycle = false;
        const seen = new Set<string>();
        while (cur) {
          if (cur === row.id) {
            isCycle = true;
            break;
          }
          if (seen.has(cur)) break; // 이미 순환이 있는 조상 체인은 더 추적하지 않음
          seen.add(cur);
          cur = parentById.get(cur) ?? null;
        }
        if (!isCycle) parent.children.push(node);
      } else {
        // parent가 없는 dangling edge는 루트로 승격 (UI에서 노드 누락 방지)
        roots.push(node);
      }
    }
  }

  return roots;
}

/** 금액을 한국 원화 형식으로 포맷 */
export function formatKRW(amount: number): string {
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
  }).format(amount);
}

/** 직급 비교 (높을수록 큰 값 반환) */
export function compareRank(a: RankType, b: RankType): number {
  return RANK_ORDER.indexOf(a) - RANK_ORDER.indexOf(b);
}
