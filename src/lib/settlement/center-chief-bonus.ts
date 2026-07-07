import type { OrgTreeRow } from '@/lib/types';
import type { Contract } from '@/lib/types/contract';
import type { RankType } from '@/lib/types/organization';
import { buildChildrenByParentFromRows } from '@/lib/settlement/settlement-org-tree';
import { DEFAULT_INCENTIVE_CONFIG } from './constants';

const CENTER_CHIEF_CUT_RANKS: readonly RankType[] = ['센터장', '사업본부장', '본사'];

/**
 * 유지장려금의 `collectSubtreeMemberIdsExcludingDownLeaders`와 대칭.
 * 자식 중 센터장 이상이면 해당 노드와 후손을 보너스 집계에서 제외한다.
 */
export function collectSubtreeMemberIdsExcludingDownCenterChiefs(
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
      if (r && (CENTER_CHIEF_CUT_RANKS as readonly string[]).includes(r)) continue;
      stack.push(ch);
    }
  }
  return out;
}

/**
 * 센터장 월정산 보너스 집계용: 정산월 대상 계약 기준 구좌 합.
 * 하위 센터장(및 그 조직)은 제외하고, 리더·영업사원 라인만 합산한다.
 */
export function subtreeSettlementUnitsForCenterChiefBonus(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  contractsByMember: Map<string, Contract[]>;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const rankById = new Map<string, RankType>();
  for (const r of params.treeRows) rankById.set(r.id, r.rank);

  const subtree = collectSubtreeMemberIdsExcludingDownCenterChiefs(
    params.memberId,
    childrenByParent,
    rankById,
  );

  let sum = 0;
  for (const mid of subtree) {
    for (const c of params.contractsByMember.get(mid) ?? []) {
      sum += Math.max(0, c.unit_count ?? 0);
    }
  }
  return sum;
}

/**
 * 센터장 월정산 보너스: 해당 정산월에 산하(하위 센터장 조직 제외) 정산 대상 구좌가
 * 기준 이상이면 지급. (DEFAULT_INCENTIVE_CONFIG.센터장: 100구좌 / 300만원)
 */
export function calculateCenterChiefSubtreeBonus(params: {
  rank: RankType;
  /** 정산월 대상 계약 기준, 하위 센터장 컷 적용 후 구좌 합 */
  subtreeSettlementUnits: number;
}): number {
  if (params.rank !== '센터장') return 0;
  const cfg = DEFAULT_INCENTIVE_CONFIG.센터장;
  if (!cfg) return 0;
  if (params.subtreeSettlementUnits < cfg.threshold) return 0;
  return cfg.amount;
}

export function centerChiefSubtreeBonusThreshold(): number {
  return DEFAULT_INCENTIVE_CONFIG.센터장?.threshold ?? 100;
}
