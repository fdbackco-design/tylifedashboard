import type {
  MonthlySettlementInsert,
  SettlementRule,
  ContractSettlementItem,
  RollupItem,
  SettlementCalculationDetail,
} from '../types/settlement';
import type { RankType, OrgTreeNode } from '../types/organization';
import type { Contract } from '../types/contract';
import { RANK_ORDER } from '../types/organization';
import { BASE_AMOUNT_PER_UNIT, DEFAULT_COMMISSION_BY_RANK, DEFAULT_INCENTIVE_CONFIG } from './constants';

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
  if (active) return active;

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
  const items: ContractSettlementItem[] = contracts.map((c) => ({
    contract_id: c.id,
    contract_code: c.contract_code,
    unit_count: c.unit_count,
    commission_per_unit: rule.commission_per_unit,
    subtotal: c.unit_count * rule.commission_per_unit,
  }));

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
function calcRollupItems(
  node: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
  rules: SettlementRule[],
  yearMonth: string,
): { items: RollupItem[]; total: number } {
  const refDate = monthEndDate(yearMonth);
  const items: RollupItem[] = [];

  for (const child of node.children) {
    const childContracts = contractsByMember.get(child.id) ?? [];
    const childUnits = childContracts.reduce((s, c) => s + c.unit_count, 0);

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
    }
  }

  const total = items.reduce((s, i) => s + i.subtotal, 0);
  return { items, total };
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
 */
export function calculateMemberSettlement(
  member: { id: string; name: string; rank: RankType },
  directContracts: Contract[],
  orgNode: OrgTreeNode,
  contractsByMember: Map<string, Contract[]>,
  rules: SettlementRule[],
  yearMonth: string,
): MonthlySettlementInsert {
  // 규칙 effective_from이 월 중간(예: 2026-04-13)이어도 해당 월 정산에 적용되도록 말일 기준으로 매칭
  const refDate = monthEndDate(yearMonth);

  // 정산 규칙 조회
  const rule = getActiveRuleOrFallback(rules, member.rank, refDate);

  // 직접 계약 정산
  // directContracts는 v_contract_settlement_base(가입 인정 기준)에서 이미 필터링된 결과를 받는다.
  const eligible = directContracts;
  const { items: directItems, total: baseCommission } = calcDirectContracts(
    eligible,
    rule,
  );

  // 롤업 계산
  const { items: rollupItems, total: rollupCommission } = calcRollupItems(
    orgNode,
    contractsByMember,
    rules,
    yearMonth,
  );

  // 산하 전체 구좌 합산 (유지 장려금 판단용)
  const subordinateUnitCount = collectSubordinateUnits(
    orgNode,
    contractsByMember,
  );
  const directUnitCount = eligible.reduce((s, c) => s + c.unit_count, 0);
  const totalUnitCount = directUnitCount + subordinateUnitCount;

  // 유지 장려금
  const incentiveAmount = calcIncentive(rule, totalUnitCount);
  const totalAmount = baseCommission + rollupCommission + incentiveAmount;

  const detail: SettlementCalculationDetail = {
    year_month: yearMonth,
    member_id: member.id,
    member_name: member.name,
    rank: member.rank,
    rule_id: rule.id,
    direct_contracts: directItems,
    rollup_items: rollupItems,
    incentive_applied: incentiveAmount > 0,
    incentive_threshold: rule.incentive_unit_threshold,
    incentive_amount: incentiveAmount,
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
    incentive_amount: incentiveAmount,
    total_amount: totalAmount,
    calculation_detail: detail,
    is_finalized: false,
  };
}

// ─────────────────────────────────────────────
// 조직 트리 빌더 (flat rows → 재귀 트리)
// ─────────────────────────────────────────────

import type { OrgTreeRow } from '../types/organization';

export function buildOrgTree(rows: OrgTreeRow[]): OrgTreeNode[] {
  const nodeMap = new Map<string, OrgTreeNode>();

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
  }

  const roots: OrgTreeNode[] = [];

  for (const row of rows) {
    const node = nodeMap.get(row.id)!;
    if (row.parent_id === null) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(row.parent_id);
      if (parent) {
        parent.children.push(node);
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
