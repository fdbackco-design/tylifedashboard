import type { RankType, OrganizationMember, OrganizationEdge } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import { findActiveRule } from '@/lib/settlement/calculator';
import { DEFAULT_COMMISSION_BY_RANK } from '@/lib/settlement/constants';
import type { OrgTreeRow } from '@/lib/types';
import {
  computeSalesMemberPromotionThreshold,
  type AttributedJoinContractRow,
  type SalesMemberPromotionThreshold,
} from '@/lib/settlement/leader-promotion';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';

export type OrgNodeMetrics = {
  cumulativeUnitCount: number;
  monthlyUnitCount: number;
  recognizedCommissionWon: number;
  paidCommissionWon: number;
};

/** get_organization_kpis 와 동일 조건으로 선필터된 계약 (페이지에서 걸러서 전달) */
type EligibleContract = {
  contract_id: string;
  join_date: string; // 'YYYY-MM-DD'
  unit_count: number;
  status: string;
  sales_member_id: string | null;
  item_name?: string | null;
};

const LEADER_OR_ABOVE: readonly RankType[] = ['리더', '센터장', '사업본부장'];
const COMMISSION_PENALTY_ITEM_NAME = '아이클레보 V1000 펫버틀러';
const COMMISSION_PENALTY_WON = 50_000;
const LEADER_MAINTENANCE_BONUS_WON = 1_000_000;

function isLeaderOrAbove(rank: RankType): boolean {
  return (LEADER_OR_ABOVE as readonly string[]).includes(rank);
}

function inWindow(joinDate: string, start: string, end: string): boolean {
  // join_date는 DATE라 'YYYY-MM-DD'로 정렬 비교 가능
  return joinDate >= start && joinDate <= end;
}

function getCommissionPerUnit(
  rules: SettlementRule[],
  rank: RankType,
  refDate: string, // 'YYYY-MM-DD'
): number {
  // 본사는 수당 대상이 아님
  if (rank === '본사') return 0;
  const rule = findActiveRule(rules, rank, refDate);
  // settlement_rules를 못 읽거나(초기 데이터 미적용/권한/환경),
  // 특정 월 규칙이 없을 때도 조직도 KPI가 0이 되지 않도록 폴백 제공
  return rule?.commission_per_unit ?? DEFAULT_COMMISSION_BY_RANK[rank] ?? 0;
}

function buildParentMap(edges: { parent_id: string | null; child_id: string }[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const e of edges) m.set(e.child_id, e.parent_id);
  return m;
}

function buildTreeRowsForPromotionThreshold(params: {
  members: Pick<OrganizationMember, 'id' | 'rank'>[];
  edges: Pick<OrganizationEdge, 'parent_id' | 'child_id'>[];
}): OrgTreeRow[] {
  const parentByChild = buildParentMap(params.edges as any);
  return params.members.map((m) => ({
    id: m.id,
    name: m.id, // threshold 계산에는 name이 필요 없음
    rank: m.rank,
    parent_id: parentByChild.get(m.id) ?? null,
    depth: 0,
  }));
}

function isContractStrictlyAfterPromotionThreshold(
  contractJoinDate: string,
  contractId: string,
  threshold: SalesMemberPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  const aj = contractJoinDate.slice(0, 10);
  const tj = threshold.threshold_join_date;
  if (aj > tj) return true;
  if (aj < tj) return false;
  // 같은 날짜면 "승격 계약 다음 계약"부터 적용 (승격 계약 자체는 승격 전으로 본다)
  return contractId.localeCompare(threshold.threshold_contract_id) > 0;
}

function effectiveRankForContract(params: {
  memberId: string;
  dbRank: RankType;
  contract: { id: string; join_date: string };
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>;
}): RankType {
  // 본사는 수당 대상이 아님(상위 로직에서 0 처리)
  if (params.dbRank === '본사') return '본사';

  // 정책 승격/유지 로직은 영업사원 ↔ 리더 범위에서만 의미가 있다.
  if (params.dbRank !== '영업사원' && params.dbRank !== '리더') return params.dbRank;

  const th = params.promotionThresholdByMemberId.get(params.memberId) ?? null;
  if (!th) {
    // DB가 리더여도 threshold가 없으면(예: 기존 리더/다른 사유) 리더로 취급한다.
    return params.dbRank;
  }

  // threshold가 존재하면, 계약 단위로 승격 전/후를 구분한다.
  const after = isContractStrictlyAfterPromotionThreshold(
    params.contract.join_date,
    params.contract.id,
    th,
  );
  return after ? '리더' : '영업사원';
}

function computeDirectUnits(
  contracts: EligibleContract[],
  start: string,
  end: string,
): { directAll: Map<string, number>; directMonthly: Map<string, number>; monthlyContracts: EligibleContract[] } {
  const directAll = new Map<string, number>();
  const directMonthly = new Map<string, number>();
  const monthlyContracts: EligibleContract[] = [];

  for (const c of contracts) {
    if (!c.sales_member_id) continue;
    const units = c.unit_count ?? 0;
    if (units <= 0) continue;

    directAll.set(c.sales_member_id, (directAll.get(c.sales_member_id) ?? 0) + units);
    if (inWindow(c.join_date, start, end)) {
      directMonthly.set(c.sales_member_id, (directMonthly.get(c.sales_member_id) ?? 0) + units);
      monthlyContracts.push(c);
    }
  }

  return { directAll, directMonthly, monthlyContracts };
}

function postOrderAggregateUnits(
  roots: { id: string; children: any[] }[],
  directAll: Map<string, number>,
  directMonthly: Map<string, number>,
  out: Map<string, OrgNodeMetrics>,
): void {
  function visit(node: { id: string; children: any[] }) {
    for (const ch of node.children ?? []) visit(ch);
    const children = (node.children ?? []) as { id: string }[];
    const cumulative = (directAll.get(node.id) ?? 0) + children.reduce((s, c) => s + (out.get(c.id)?.cumulativeUnitCount ?? 0), 0);
    const monthly = (directMonthly.get(node.id) ?? 0) + children.reduce((s, c) => s + (out.get(c.id)?.monthlyUnitCount ?? 0), 0);
    out.set(node.id, {
      cumulativeUnitCount: cumulative,
      monthlyUnitCount: monthly,
      recognizedCommissionWon: out.get(node.id)?.recognizedCommissionWon ?? 0,
      paidCommissionWon: out.get(node.id)?.paidCommissionWon ?? 0,
    });
  }
  for (const r of roots) visit(r);
}

function getAncestors(
  memberId: string,
  parentByChild: Map<string, string | null>,
): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  let cur: string | null = memberId;
  while (true) {
    const p = parentByChild.get(cur);
    if (!p) break;
    if (visited.has(p)) break;
    visited.add(p);
    out.push(p);
    cur = p;
  }
  return out;
}

/**
 * 수당 계산용 상위 체인.
 * - 본사는 조직 루트로는 유지(구좌 집계에는 포함)하되,
 * - 수당 계산(인정/실지급)에서는 본사를 상위자/귀속 후보로 보지 않는다.
 *
 * 따라서 상위 탐색은 계속하되(rankById로 본사 판단),
 * 반환되는 체인에서는 본사 노드를 제외한다.
 */
function getCommissionAncestorsExcludingHq(
  memberId: string,
  parentByChild: Map<string, string | null>,
  rankById: Map<string, RankType>,
): string[] {
  const out: string[] = [];
  const visited = new Set<string>();
  let cur: string | null = memberId;
  while (true) {
    const p = parentByChild.get(cur);
    if (!p) break;
    // DB에 parent 체인 순환이 있으면 무한 루프 방지 (예: A↔B)
    if (visited.has(p)) break;
    visited.add(p);
    const r = rankById.get(p);
    if (r && r !== '본사') out.push(p);
    cur = p;
  }
  return out;
}

export function calculateOrgNodeMetrics(params: {
  roots: any[]; // OrgTreeNode[]
  members: Pick<OrganizationMember, 'id' | 'rank'>[];
  edges: Pick<OrganizationEdge, 'parent_id' | 'child_id'>[];
  contracts: EligibleContract[]; // KPI 가입 인정 계약(선필터)
  rules: SettlementRule[];
  settlementWindow: { start_date: string; end_date: string; label_year_month: string };
}): Record<string, OrgNodeMetrics> {
  const { roots, members, edges, contracts, rules, settlementWindow } = params;
  const parentByChild = buildParentMap(edges as { parent_id: string | null; child_id: string }[]);
  const rankById = new Map<string, RankType>();
  for (const m of members) rankById.set(m.id, m.rank);

  // 정책 승격(산하 가입 누적 20구좌) 기준을 조직도 KPI에도 동일 적용:
  // - DB rank가 리더로 올라가 있어도, 승격 계약 이전 계약은 영업사원 단가로 계산되어야 한다.
  // - threshold 계산에는 "가입 인정 계약" 전체를 사용(월 구간 외 과거 누적 포함)
  const treeRowsForThreshold = buildTreeRowsForPromotionThreshold({ members, edges });
  const rankByIdForThreshold = new Map<string, RankType>();
  for (const m of members) {
    // 리더도 threshold 계산 대상에 포함시키기 위해(정책 승격으로 올라간 경우),
    // 임시로 영업사원으로 취급해 threshold를 계산한다.
    // (센터장 이상은 정책 승격 범위 밖이므로 그대로 둔다.)
    rankByIdForThreshold.set(m.id, m.rank === '리더' ? '영업사원' : m.rank);
  }
  const joinAttributed: AttributedJoinContractRow[] = (contracts ?? [])
    .filter((c) => (c.status ?? '').trim() === '가입')
    .filter((c) => !!c.sales_member_id)
    .map((c) => ({
      id: c.contract_id,
      join_date: c.join_date.slice(0, 10),
      unit_count: c.unit_count ?? 0,
      sales_member_id: c.sales_member_id as string,
    }));
  const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(
    treeRowsForThreshold,
    joinAttributed,
    rankByIdForThreshold,
  );

  const metrics = new Map<string, OrgNodeMetrics>();
  for (const m of members) {
    metrics.set(m.id, { cumulativeUnitCount: 0, monthlyUnitCount: 0, recognizedCommissionWon: 0, paidCommissionWon: 0 });
  }

  const { directAll, directMonthly, monthlyContracts } = computeDirectUnits(
    contracts,
    settlementWindow.start_date,
    settlementWindow.end_date,
  );

  // 1) 구좌(누적/월) = 본인 direct + 하위 subtree 합산
  postOrderAggregateUnits(roots as any[], directAll, directMonthly, metrics);

  // 2) 인정수당/실지급액(월 기준) — 계약 단위로 경로를 따라 배분
  const refDate = `${settlementWindow.label_year_month}-01`;

  for (const c of monthlyContracts) {
    const origin = c.sales_member_id;
    if (!origin) continue;
    const unit = c.unit_count ?? 0;
    if (unit <= 0) continue;
    const hasItemPenalty = (c.item_name ?? '').trim() === COMMISSION_PENALTY_ITEM_NAME;

    const originRank = rankById.get(origin);
    if (!originRank) continue;

    // 수당 계산은 “본사 제외 체인”으로 수행
    const ancestors = getCommissionAncestorsExcludingHq(origin, parentByChild, rankById);

    // 2-1) 인정수당
    // - direct upper(본사 제외)이 있으면 그 노드가 인정수당 대상
    // - 없으면(즉 본사 직속/루트라인) 본인이 최상위 사원으로 간주되어 인정수당을 받는다
    const directUplineId = ancestors[0] ?? null;
    const recognizedRecipientId = directUplineId ?? origin;
    const recognizedDbRank = directUplineId ? rankById.get(directUplineId) : originRank;
    if (recognizedDbRank) {
      const recognizedEffectiveRank = effectiveRankForContract({
        memberId: recognizedRecipientId,
        dbRank: recognizedDbRank,
        contract: { id: c.contract_id, join_date: c.join_date },
        promotionThresholdByMemberId,
      });
      const rate = getCommissionPerUnit(rules, recognizedEffectiveRank, refDate);
      if (rate > 0) {
        const prev = metrics.get(recognizedRecipientId)!;
        prev.recognizedCommissionWon += rate * unit;
      }
    }
    if (hasItemPenalty) {
      const prev = metrics.get(recognizedRecipientId);
      if (prev) prev.recognizedCommissionWon -= COMMISSION_PENALTY_WON;
    }

    // 2-2) 실지급액
    // - 리더 이상이 있으면 “가장 높은(루트에 가까운) 리더 이상”에게 귀속
    // - 리더 이상이 없으면 “본사 제외 체인에서의 최상위 사원(영업사원)”에게 귀속
    let highestLeaderId: string | null = null;
    let topSalespersonId: string | null = null;
    for (const id of ancestors) {
      const r = rankById.get(id);
      if (!r) continue;
      if (r === '영업사원') topSalespersonId = id;
      if (isLeaderOrAbove(r)) highestLeaderId = id;
    }
    // 본사 직속/루트라인 예외:
    // - 상위 경로(본사 제외)에 리더 이상/영업사원이 전혀 없으면,
    //   본인(리더/센터장/본부장/영업사원)이 “최상위 라인”이므로 실지급 귀속 대상이 된다.
    if (!topSalespersonId && originRank === '영업사원') topSalespersonId = origin;

    const payRecipientId =
      highestLeaderId ??
      topSalespersonId ??
      (originRank !== '본사' ? origin : null);
    if (payRecipientId) {
      const payDbRank = rankById.get(payRecipientId);
      if (payDbRank) {
        const payEffectiveRank = effectiveRankForContract({
          memberId: payRecipientId,
          dbRank: payDbRank,
          contract: { id: c.contract_id, join_date: c.join_date },
          promotionThresholdByMemberId,
        });
        const payRate = getCommissionPerUnit(rules, payEffectiveRank, refDate);
        if (payRate > 0) {
          const prev = metrics.get(payRecipientId)!;
          prev.paidCommissionWon += payRate * unit;
        }
      }
    }
    if (hasItemPenalty && payRecipientId) {
      const prev = metrics.get(payRecipientId);
      if (prev) prev.paidCommissionWon -= COMMISSION_PENALTY_WON;
    }

    // 2-3) 차액 인정(override)
    // 실지급 귀속 대상이 리더 이상이면, (실지급 대상 수당 - direct upper 수당)만큼 인정수당을 추가로 기록
    // (본사 직속/루트라인처럼 direct upper가 없으면 차액 개념이 없으므로 스킵)
    if (payRecipientId && directUplineId) {
      const payDbRank = rankById.get(payRecipientId);
      const directDbRank = rankById.get(directUplineId);
      if (payDbRank && directDbRank) {
        const payEffectiveRank = effectiveRankForContract({
          memberId: payRecipientId,
          dbRank: payDbRank,
          contract: { id: c.contract_id, join_date: c.join_date },
          promotionThresholdByMemberId,
        });
        const directEffectiveRank = effectiveRankForContract({
          memberId: directUplineId,
          dbRank: directDbRank,
          contract: { id: c.contract_id, join_date: c.join_date },
          promotionThresholdByMemberId,
        });
        if (!isLeaderOrAbove(payEffectiveRank)) continue;

        const payRate = getCommissionPerUnit(rules, payEffectiveRank, refDate);
        const directRate = getCommissionPerUnit(rules, directEffectiveRank, refDate);
        const diff = Math.max(0, payRate - directRate);
        if (diff > 0) {
          const prev = metrics.get(payRecipientId)!;
          prev.recognizedCommissionWon += diff * unit;
        }
      }
    }
  }

  // 3) 리더 유지 장려금(정산월 말일까지 산하 가입 누적 20구좌 유지) — 조직도 KPI에도 반영
  // - 요구 기대값(예: +100만원)을 맞추기 위해 인정/실지급 모두에 1회성으로 더한다.
  // - 대상: 정책 승격(threshold 존재)한 영업사원(또는 리더로 승격된 경우 포함)
  {
    const childrenByParent = buildChildrenByParentFromRows(treeRowsForThreshold);
    const endInclusive = settlementWindow.end_date.slice(0, 10);

    // 가입 계약 누적(정산월 말까지) 합산
    const joinUnitsBySalesMember = new Map<string, number>();
    for (const c of joinAttributed) {
      const jd = c.join_date.slice(0, 10);
      if (jd > endInclusive) continue;
      joinUnitsBySalesMember.set(
        c.sales_member_id,
        (joinUnitsBySalesMember.get(c.sales_member_id) ?? 0) + Math.max(0, c.unit_count ?? 0),
      );
    }

    for (const m of members) {
      const th = promotionThresholdByMemberId.get(m.id) ?? null;
      if (!th) continue;

      // 유지 장려금은 원칙적으로 "영업사원→리더 승격" 케이스에 해당하므로,
      // DB가 리더여도 정책 승격으로 올라간 것으로 간주하여 포함한다.
      if (m.rank !== '영업사원' && m.rank !== '리더') continue;

      const subtree = collectSubtreeMemberIdsDownstream(m.id, childrenByParent);
      let sum = 0;
      for (const sid of subtree) sum += joinUnitsBySalesMember.get(sid) ?? 0;
      if (sum < 20) continue;

      const prev = metrics.get(m.id);
      if (!prev) continue;
      prev.recognizedCommissionWon += LEADER_MAINTENANCE_BONUS_WON;
      prev.paidCommissionWon += LEADER_MAINTENANCE_BONUS_WON;
    }
  }

  return Object.fromEntries(metrics.entries());
}

