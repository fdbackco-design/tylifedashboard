import type { OrgTreeRow } from '@/lib/types';
import type { Contract } from '@/lib/types/contract';
import type { RankType } from '@/lib/types/organization';
import { buildChildrenByParentFromRows } from '@/lib/settlement/settlement-org-tree';
import { DEFAULT_INCENTIVE_CONFIG } from './constants';

/** 하위 사업본부장·본사 조직은 본부장 보너스 집계에서 제외 */
const DIVISION_HEAD_CUT_RANKS: readonly RankType[] = ['사업본부장', '본사'];

/**
 * 센터장 보너스의 하위 센터장 컷과 대칭.
 * 자식 중 사업본부장 이상이면 해당 노드와 후손을 보너스 집계에서 제외한다.
 * (산하 센터장·리더·영업사원 라인은 포함)
 */
export function collectSubtreeMemberIdsExcludingDownDivisionHeads(
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
      if (r && (DIVISION_HEAD_CUT_RANKS as readonly string[]).includes(r)) continue;
      stack.push(ch);
    }
  }
  return out;
}

/**
 * 사업본부장 월정산 보너스 집계용: 정산월 대상 계약 기준 구좌 합.
 * 하위 사업본부장(및 그 조직)은 제외하고, 센터장·리더·영업사원 라인은 합산한다.
 */
export function subtreeSettlementUnitsForDivisionHeadBonus(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  contractsByMember: Map<string, Contract[]>;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const rankById = new Map<string, RankType>();
  for (const r of params.treeRows) rankById.set(r.id, r.rank);

  const subtree = collectSubtreeMemberIdsExcludingDownDivisionHeads(
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
 * 사업본부장 월정산 보너스 금액(구좌만 판정).
 * 직급 폴백은 호출측에서 담당한다.
 */
export function divisionHeadSubtreeBonusForUnits(subtreeSettlementUnits: number): number {
  const cfg = DEFAULT_INCENTIVE_CONFIG.사업본부장;
  if (!cfg) return 0;
  if (subtreeSettlementUnits < cfg.threshold) return 0;
  return cfg.amount;
}

/**
 * 사업본부장 월정산 보너스: 해당 정산월에 산하(하위 사업본부장 조직 제외) 정산 대상 구좌가
 * 기준 이상이면 지급. (DEFAULT_INCENTIVE_CONFIG.사업본부장: 300구좌 / 500만원)
 */
export function calculateDivisionHeadSubtreeBonus(params: {
  rank: RankType;
  /** 정산월 대상 계약 기준, 하위 사업본부장 컷 적용 후 구좌 합 */
  subtreeSettlementUnits: number;
}): number {
  if (params.rank !== '사업본부장') return 0;
  return divisionHeadSubtreeBonusForUnits(params.subtreeSettlementUnits);
}

export function divisionHeadSubtreeBonusThreshold(): number {
  return DEFAULT_INCENTIVE_CONFIG.사업본부장?.threshold ?? 300;
}
