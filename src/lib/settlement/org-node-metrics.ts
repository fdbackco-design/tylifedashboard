import type { RankType, OrganizationMember, OrganizationEdge } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import { findActiveRule } from '@/lib/settlement/calculator';
import {
  DEFAULT_COMMISSION_BY_RANK,
  commissionPenaltyWonForItemName,
} from '@/lib/settlement/constants';
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

function buildParentMapFromTreeRows(rows: OrgTreeRow[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const r of rows) m.set(r.id, r.parent_id ?? null);
  return m;
}

export function calculateOrgNodeMetrics(params: {
  roots: any[]; // OrgTreeNode[]
  members: Pick<OrganizationMember, 'id' | 'rank'>[];
  edges: Pick<OrganizationEdge, 'parent_id' | 'child_id'>[];
  /**
   * 조직도와 동일한 parent(예: source_customer_id 본사 직속 등). edges만 쓰면
   * 화면 트리와 달라 E2 직속 상위가 A2로 잡혀 인정수당이 과대될 수 있다.
   */
  treeRows?: OrgTreeRow[];
  /** 정책 승격자의 이전 상위(리더). 승격 전/후 귀속 분기에 사용 */
  previousLeaderByPromotedMemberId?: Map<string, string | null>;
  /** 본사 id (승격 후 상위로 간주). */
  hqId?: string | null;
  /** 유지장려(리더) 1회성 차단 여부 (true면 0). */
  leaderMaintenanceBonusBlockedByMemberId?: Map<string, boolean>;
  /** 정책 승격 이벤트가 기록된 멤버 id set (리더를 승격 threshold 계산에 포함시키기 위함) */
  policyPromotedMemberIdSet?: Set<string>;
  /**
   * true면 인정수당/실지급액을 \"본사(HQ) 직속 최상위 라인\"으로 귀속(집계)한다.
   * - 본사(HQ) 노드 자체는 0 유지
   * - HQ 직속 라인장(=parent가 HQ인 노드)에게 라인 전체 금액을 몰아준다
   * - 라인 하위 노드의 금액은 0으로 내려(이중 집계 방지), 구좌는 기존대로 유지
   */
  attributeCommissionToTopLineUnderHq?: boolean;
  contracts: EligibleContract[]; // KPI 가입 인정 계약(선필터)
  rules: SettlementRule[];
  settlementWindow: { start_date: string; end_date: string; label_year_month: string };
}): Record<string, OrgNodeMetrics> {
  const {
    roots,
    members,
    edges,
    treeRows: treeRowsParam,
    contracts,
    rules,
    settlementWindow,
    previousLeaderByPromotedMemberId,
    hqId,
    leaderMaintenanceBonusBlockedByMemberId,
    policyPromotedMemberIdSet,
    attributeCommissionToTopLineUnderHq = false,
  } = params;
  const parentByChild = treeRowsParam?.length
    ? buildParentMapFromTreeRows(treeRowsParam)
    : buildParentMap(edges as { parent_id: string | null; child_id: string }[]);
  const rankById = new Map<string, RankType>();
  for (const m of members) rankById.set(m.id, m.rank);

  // 정책 승격(산하 가입 누적 20구좌) 기준을 조직도 KPI에도 동일 적용:
  // - DB rank가 리더로 올라가 있어도, 승격 계약 이전 계약은 영업사원 단가로 계산되어야 한다.
  // - threshold 계산에는 "가입 인정 계약" 전체를 사용(월 구간 외 과거 누적 포함)
  const treeRowsForThreshold = treeRowsParam?.length
    ? treeRowsParam
    : buildTreeRowsForPromotionThreshold({ members, edges });
  const rankByIdForThreshold = new Map<string, RankType>();
  for (const m of members) {
    // 기존 DB 리더까지 영업사원으로 바꾸면 잘못 승격/유지장려가 붙을 수 있다.
    // 따라서 "정책 승격 이벤트가 있는 리더"만 임시로 영업사원 취급한다.
    const isPolicyPromoted = policyPromotedMemberIdSet?.has(m.id) ?? false;
    rankByIdForThreshold.set(m.id, m.rank === '리더' && isPolicyPromoted ? '영업사원' : m.rank);
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

  return calculateOrgNodeMetricsAlignedToSettlement({
    roots,
    members,
    contracts: contracts ?? [],
    rules,
    settlementWindow,
    rankById,
    parentByChild,
    promotionThresholdByMemberId,
    treeRowsForThreshold,
    joinAttributed,
    previousLeaderByPromotedMemberId,
    hqId,
    leaderMaintenanceBonusBlockedByMemberId,
    attributeCommissionToTopLineUnderHq,
  });
}

function calculateOrgNodeMetricsAlignedToSettlement(params: {
  roots: any[];
  members: Pick<OrganizationMember, 'id' | 'rank'>[];
  contracts: EligibleContract[];
  rules: SettlementRule[];
  settlementWindow: { start_date: string; end_date: string; label_year_month: string };
  rankById: Map<string, RankType>;
  parentByChild: Map<string, string | null>;
  promotionThresholdByMemberId: Map<string, SalesMemberPromotionThreshold | null>;
  treeRowsForThreshold: OrgTreeRow[];
  joinAttributed: AttributedJoinContractRow[];
  previousLeaderByPromotedMemberId?: Map<string, string | null>;
  hqId?: string | null;
  leaderMaintenanceBonusBlockedByMemberId?: Map<string, boolean>;
  attributeCommissionToTopLineUnderHq?: boolean;
}): Record<string, OrgNodeMetrics> {
  const {
    roots,
    members,
    contracts,
    rules,
    settlementWindow,
    rankById,
    parentByChild,
    promotionThresholdByMemberId,
    treeRowsForThreshold,
    joinAttributed,
    previousLeaderByPromotedMemberId,
    hqId,
    leaderMaintenanceBonusBlockedByMemberId,
    attributeCommissionToTopLineUnderHq = false,
  } = params;

  const refDate = `${settlementWindow.label_year_month}-01`;
  const endInclusive = settlementWindow.end_date.slice(0, 10);

  const hasDownlineById = new Map<string, boolean>();
  (function indexDownline(nodes: any[]) {
    for (const n of nodes ?? []) {
      hasDownlineById.set(n.id as string, ((n.children ?? []).length ?? 0) > 0);
      indexDownline(n.children ?? []);
    }
  })(roots as any[]);

  const getRate = (memberId: string, contract: { id: string; join_date: string }): number => {
    const dbRank = rankById.get(memberId);
    if (!dbRank) return 0;
    const eff = effectiveRankForContract({ memberId, dbRank, contract, promotionThresholdByMemberId });
    return getCommissionPerUnit(rules, eff, refDate);
  };

  const effectiveParent = (childId: string, contract: { id: string; join_date: string }): string | null => {
    const prev = previousLeaderByPromotedMemberId?.get(childId) ?? null;
    if (prev) {
      const th = promotionThresholdByMemberId.get(childId) ?? null;
      if (th && !isContractStrictlyAfterPromotionThreshold(contract.join_date, contract.id, th)) return prev;
      return hqId ?? null;
    }
    return parentByChild.get(childId) ?? null;
  };

  const cumUnits = new Map<string, number>();
  const monUnits = new Map<string, number>();
  const baseById = new Map<string, number>();
  const rollupById = new Map<string, number>();
  const bonusById = new Map<string, number>();

  for (const m of members) {
    cumUnits.set(m.id, 0);
    monUnits.set(m.id, 0);
    baseById.set(m.id, 0);
    rollupById.set(m.id, 0);
    bonusById.set(m.id, 0);
  }

  // 1) 구좌(누적/월): 계약 단위로 effective 체인을 따라 상위에도 누적
  for (const c of contracts) {
    const origin = c.sales_member_id;
    if (!origin) continue;
    const unit = c.unit_count ?? 0;
    if (unit <= 0) continue;
    const jd = c.join_date.slice(0, 10);
    if (!jd || jd > endInclusive) continue;

    const inMonth = inWindow(jd, settlementWindow.start_date, settlementWindow.end_date);
    cumUnits.set(origin, (cumUnits.get(origin) ?? 0) + unit);
    if (inMonth) monUnits.set(origin, (monUnits.get(origin) ?? 0) + unit);

    const contractKey = { id: c.contract_id, join_date: jd };
    const visited = new Set<string>();
    let cur = origin;
    while (true) {
      const p = effectiveParent(cur, contractKey);
      if (!p) break;
      if (visited.has(p)) break;
      visited.add(p);
      cumUnits.set(p, (cumUnits.get(p) ?? 0) + unit);
      if (inMonth) monUnits.set(p, (monUnits.get(p) ?? 0) + unit);
      cur = p;
    }
  }

  // 2) 금액(월): 기본수당/롤업수당 (정산 재계산과 동일 규칙)
  for (const c of contracts) {
    const origin = c.sales_member_id;
    if (!origin) continue;
    const unit = c.unit_count ?? 0;
    if (unit <= 0) continue;
    const jd = c.join_date.slice(0, 10);
    if (!inWindow(jd, settlementWindow.start_date, settlementWindow.end_date)) continue;

    const contractKey = { id: c.contract_id, join_date: jd };
    const originRate = getRate(origin, contractKey);

    // 기본수당 귀속: 승격 전(승격 계약 포함)은 이전 리더에게 귀속(단가=영업사원), 승격 후만 본인
    let baseRecipient = origin;
    const prev = previousLeaderByPromotedMemberId?.get(origin) ?? null;
    const th = promotionThresholdByMemberId.get(origin) ?? null;
    if (prev && th && !isContractStrictlyAfterPromotionThreshold(jd, c.contract_id, th)) {
      const prevRank = rankById.get(prev) ?? null;
      if (prevRank === '리더') baseRecipient = prev;
    }
    baseById.set(baseRecipient, (baseById.get(baseRecipient) ?? 0) + originRate * unit);
    const penalty = commissionPenaltyWonForItemName(c.item_name);
    if (penalty > 0) {
      baseById.set(baseRecipient, (baseById.get(baseRecipient) ?? 0) - penalty);
    }

    // 롤업: effective parent 체인을 따라 (상위-하위) 차액을 상위에 적립
    const visited = new Set<string>();
    let childId = origin;
    let childRate = originRate;
    while (true) {
      const parentId = effectiveParent(childId, contractKey);
      if (!parentId) break;
      if (visited.has(parentId)) break;
      visited.add(parentId);
      const parentDbRank = rankById.get(parentId);
      if (!parentDbRank) break;
      if (parentDbRank === '본사') break;
      const parentRate = getRate(parentId, contractKey);
      const diff = Math.max(0, parentRate - childRate);
      if (diff > 0) rollupById.set(parentId, (rollupById.get(parentId) ?? 0) + diff * unit);
      childId = parentId;
      childRate = parentRate;
    }
  }

  // 3) 유지장려(리더) — 정책 승격(threshold 존재) + 25일까지 20구좌 유지
  {
    const childrenByParent = buildChildrenByParentFromRows(treeRowsForThreshold);
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
      if (m.rank !== '영업사원' && m.rank !== '리더') continue;
      const blocked = leaderMaintenanceBonusBlockedByMemberId?.get(m.id) ?? false;
      if (blocked) continue;

      const subtree = collectSubtreeMemberIdsDownstream(m.id, childrenByParent);
      let sum = 0;
      for (const sid of subtree) sum += joinUnitsBySalesMember.get(sid) ?? 0;
      if (sum < 20) continue;
      bonusById.set(m.id, LEADER_MAINTENANCE_BONUS_WON);
    }
  }

  const out = new Map<string, OrgNodeMetrics>();
  for (const m of members) {
    const base = baseById.get(m.id) ?? 0;
    const roll = rollupById.get(m.id) ?? 0;
    const bonus = bonusById.get(m.id) ?? 0;
    const totalPaid = base + roll + bonus;
    // 요구: 하위조직이 있어도 "본인 직접계약 수당"을 인정수당에 포함한다.
    // 따라서 인정수당은 실지급액(기본+롤업+유지장려)과 동일하게 계산한다.
    const recognized = totalPaid;
    out.set(m.id, {
      cumulativeUnitCount: cumUnits.get(m.id) ?? 0,
      monthlyUnitCount: monUnits.get(m.id) ?? 0,
      recognizedCommissionWon: recognized,
      paidCommissionWon: totalPaid,
    });
  }

  // 표시/집계 정책: 본사(HQ) 직속 최상위 라인으로 금액 귀속
  if (attributeCommissionToTopLineUnderHq && hqId) {
    const topLineByMemberId = new Map<string, string>();
    const isHq = (id: string) => id === hqId || (rankById.get(id) ?? null) === '본사';

    const getTopLine = (memberId: string): string => {
      const cached = topLineByMemberId.get(memberId);
      if (cached) return cached;
      if (isHq(memberId)) {
        topLineByMemberId.set(memberId, memberId);
        return memberId;
      }
      let cur = memberId;
      const visited = new Set<string>();
      for (let i = 0; i < 128; i++) {
        const p = parentByChild.get(cur) ?? null;
        if (!p) break;
        if (visited.has(p)) break;
        visited.add(p);
        if (isHq(p)) break; // cur가 HQ 직속 라인장
        cur = p;
      }
      topLineByMemberId.set(memberId, cur);
      return cur;
    };

    const aggRecognizedByTop = new Map<string, number>();
    const aggPaidByTop = new Map<string, number>();

    for (const m of members) {
      if (isHq(m.id)) continue; // HQ 자체는 0 유지
      const top = getTopLine(m.id);
      const v = out.get(m.id);
      if (!v) continue;
      aggRecognizedByTop.set(top, (aggRecognizedByTop.get(top) ?? 0) + (v.recognizedCommissionWon ?? 0));
      aggPaidByTop.set(top, (aggPaidByTop.get(top) ?? 0) + (v.paidCommissionWon ?? 0));
    }

    for (const m of members) {
      const v = out.get(m.id);
      if (!v) continue;
      if (isHq(m.id)) {
        out.set(m.id, { ...v, recognizedCommissionWon: 0, paidCommissionWon: 0 });
        continue;
      }
      const top = getTopLine(m.id);
      if (top === m.id) {
        out.set(m.id, {
          ...v,
          recognizedCommissionWon: aggRecognizedByTop.get(m.id) ?? 0,
          paidCommissionWon: aggPaidByTop.get(m.id) ?? 0,
        });
      } else {
        // 라인 하위는 금액 0(라인장에 귀속)
        out.set(m.id, { ...v, recognizedCommissionWon: 0, paidCommissionWon: 0 });
      }
    }
  }

  return Object.fromEntries(out.entries());
}

