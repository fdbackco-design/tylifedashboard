import type { OrgTreeRow } from '@/lib/types';
import type { Contract } from '@/lib/types/contract';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import {
  splitContractUnitsByCenterChiefThreshold,
  type CenterChiefPromotionThreshold,
} from '@/lib/settlement/center-chief-promotion';
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

function collectCutDownCenterChiefIds(
  baseSubtree: Set<string>,
  childrenByParent: Map<string, string[]>,
  rankById: Map<string, RankType>,
): string[] {
  const cut: string[] = [];
  for (const id of baseSubtree) {
    for (const ch of childrenByParent.get(id) ?? []) {
      const r = rankById.get(ch);
      if (r && (CENTER_CHIEF_CUT_RANKS as readonly string[]).includes(r)) cut.push(ch);
    }
  }
  return cut;
}

function contractOrderRef(c: Contract): {
  id: string;
  join_date: string;
  happy_call_at?: string | null;
  created_at?: string | null;
  invoice_registered_at?: string | null;
  unit_count: number;
} {
  return {
    id: c.id,
    join_date: String(c.join_date ?? '').slice(0, 10),
    happy_call_at: c.happy_call_at ?? null,
    created_at: c.created_at ?? null,
    invoice_registered_at: c.invoice_registered_at ?? null,
    unit_count: Math.max(0, c.unit_count ?? 0),
  };
}

/**
 * 센터장 월정산 보너스 집계용: 정산월 대상 계약 기준 구좌 합.
 *
 * 규칙:
 *  - 기본: 하위 센터장·본부장·본사 조직 제외, 리더·영업사원 라인만 합산.
 *  - 예외: 잘린 하위 센터장(또는 본부장)의 리더→센터장 승급 확정 계약까지는 상위에 포함.
 */
export function subtreeSettlementUnitsForCenterChiefBonus(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  contractsByMember: Map<string, Contract[]>;
  /** 하위 센터장 승급 확정 계약까지 포함 시 사용 */
  centerChiefThresholdByMemberId?: Map<string, CenterChiefPromotionThreshold | null>;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const rankById = new Map<string, RankType>();
  for (const r of params.treeRows) rankById.set(r.id, r.rank);

  const baseSubtree = collectSubtreeMemberIdsExcludingDownCenterChiefs(
    params.memberId,
    childrenByParent,
    rankById,
  );

  let sum = 0;
  for (const mid of baseSubtree) {
    for (const c of params.contractsByMember.get(mid) ?? []) {
      sum += Math.max(0, c.unit_count ?? 0);
    }
  }

  const thresholds = params.centerChiefThresholdByMemberId;
  if (!thresholds) return sum;

  for (const cutId of collectCutDownCenterChiefIds(baseSubtree, childrenByParent, rankById)) {
    const th = thresholds.get(cutId) ?? null;
    if (!th) continue;
    const underCut = collectSubtreeMemberIdsDownstream(cutId, childrenByParent);
    for (const mid of underCut) {
      for (const c of params.contractsByMember.get(mid) ?? []) {
        sum += splitContractUnitsByCenterChiefThreshold(contractOrderRef(c), th).preCenterChiefUnits;
      }
    }
  }
  return sum;
}

/**
 * 센터장 월정산 보너스 금액(구좌만 판정).
 * 직급 폴백(월중 본부장 승급 등)은 호출측에서 담당한다.
 */
export function centerChiefSubtreeBonusForUnits(subtreeSettlementUnits: number): number {
  const cfg = DEFAULT_INCENTIVE_CONFIG.센터장;
  if (!cfg) return 0;
  if (subtreeSettlementUnits < cfg.threshold) return 0;
  return cfg.amount;
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
  return centerChiefSubtreeBonusForUnits(params.subtreeSettlementUnits);
}

export function centerChiefSubtreeBonusThreshold(): number {
  return DEFAULT_INCENTIVE_CONFIG.센터장?.threshold ?? 100;
}
