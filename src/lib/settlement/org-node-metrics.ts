import type { RankType, OrganizationMember, OrganizationEdge } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import { findActiveRule } from '@/lib/settlement/calculator';
import { DEFAULT_COMMISSION_BY_RANK } from '@/lib/settlement/constants';

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
};

const LEADER_OR_ABOVE: readonly RankType[] = ['리더', '센터장', '사업본부장'];

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
  let cur: string | null = memberId;
  while (true) {
    const p = parentByChild.get(cur);
    if (!p) break;
    out.push(p);
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

    const directParentId = parentByChild.get(origin) ?? null;
    if (!directParentId) continue;

    const parentRank = rankById.get(directParentId);
    if (!parentRank) continue;

    // 보완 규칙: 직접 상위자가 본사인 경우 인정수당 0
    const parentRate = parentRank === '본사' ? 0 : getCommissionPerUnit(rules, parentRank, refDate);
    if (parentRate > 0) {
      const prev = metrics.get(directParentId)!;
      prev.recognizedCommissionWon += parentRate * unit;
    }

    const ancestors = getAncestors(origin, parentByChild);
    // 상위 경로에 리더 이상이 있으면 “가장 높은(루트에 가까운) 리더 이상”에게 실지급 귀속
    let highestLeaderId: string | null = null;
    let topSalespersonId: string | null = null;
    for (const id of ancestors) {
      const r = rankById.get(id);
      if (!r) continue;
      if (r === '영업사원') topSalespersonId = id;
      if (isLeaderOrAbove(r)) highestLeaderId = id;
    }
    const payRecipientId = highestLeaderId ?? topSalespersonId;
    if (payRecipientId && parentRate > 0) {
      const prev = metrics.get(payRecipientId)!;
      prev.paidCommissionWon += parentRate * unit;
    }

    // 차액 인정(override): 실지급 귀속 대상이 리더 이상이면, (상위 수당 - 직접상위 수당)만큼 인정수당을 추가로 기록
    if (payRecipientId) {
      const payRank = rankById.get(payRecipientId);
      if (payRank && isLeaderOrAbove(payRank) && parentRate > 0) {
        const payRate = getCommissionPerUnit(rules, payRank, refDate);
        const diff = Math.max(0, payRate - parentRate);
        if (diff > 0) {
          const prev = metrics.get(payRecipientId)!;
          prev.recognizedCommissionWon += diff * unit;
        }
      }
    }
  }

  return Object.fromEntries(metrics.entries());
}

