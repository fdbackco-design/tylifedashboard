import type { OrgTreeRow } from '@/lib/types';
import type { Contract } from '@/lib/types/contract';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import { isContractAtOrAfterDivisionHeadPostRate } from '@/lib/settlement/division-head-promotion';
import type { DivisionHeadPromotionThreshold } from '@/lib/settlement/division-head-promotion';
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

function collectCutDownDivisionHeadIds(
  baseSubtree: Set<string>,
  childrenByParent: Map<string, string[]>,
  rankById: Map<string, RankType>,
): string[] {
  const cut: string[] = [];
  for (const id of baseSubtree) {
    for (const ch of childrenByParent.get(id) ?? []) {
      const r = rankById.get(ch);
      if (r && (DIVISION_HEAD_CUT_RANKS as readonly string[]).includes(r)) cut.push(ch);
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

/** 본부장 승급 확정 계약까지(승급 전) 구좌 */
function preDivisionHeadUnitsForContract(
  c: Contract,
  threshold: DivisionHeadPromotionThreshold,
): number {
  const total = Math.max(0, c.unit_count ?? 0);
  if (total === 0) return 0;
  if (isContractAtOrAfterDivisionHeadPostRate(contractOrderRef(c), threshold)) return 0;
  return total;
}

/**
 * 사업본부장 월정산 보너스 집계용: 정산월 대상 계약 기준 구좌 합.
 *
 * 규칙:
 *  - 기본: 하위 사업본부장·본사 조직 제외, 센터장·리더·영업사원 라인 합산.
 *  - 예외: 잘린 하위 본부장의 센터장→본부장 승급 확정 계약까지는 상위에 포함.
 */
export function subtreeSettlementUnitsForDivisionHeadBonus(params: {
  memberId: string;
  treeRows: OrgTreeRow[];
  contractsByMember: Map<string, Contract[]>;
  /** 하위 본부장 승급 확정 계약까지 포함 시 사용 */
  divisionHeadThresholdByMemberId?: Map<string, DivisionHeadPromotionThreshold | null>;
}): number {
  const childrenByParent = buildChildrenByParentFromRows(params.treeRows);
  const rankById = new Map<string, RankType>();
  for (const r of params.treeRows) rankById.set(r.id, r.rank);

  const baseSubtree = collectSubtreeMemberIdsExcludingDownDivisionHeads(
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

  const thresholds = params.divisionHeadThresholdByMemberId;
  if (!thresholds) return sum;

  for (const cutId of collectCutDownDivisionHeadIds(baseSubtree, childrenByParent, rankById)) {
    const th = thresholds.get(cutId) ?? null;
    if (!th) continue;
    const underCut = collectSubtreeMemberIdsDownstream(cutId, childrenByParent);
    for (const mid of underCut) {
      for (const c of params.contractsByMember.get(mid) ?? []) {
        sum += preDivisionHeadUnitsForContract(c, th);
      }
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
