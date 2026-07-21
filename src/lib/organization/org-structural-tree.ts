import {
  buildOrgContractSalesRemap,
  type ContractSalesRemapInput,
  type OrgMemberForContractRemap,
} from '@/lib/organization/org-contract-sales-remap';
import type { OrgTreeRow } from '@/lib/types';

export type OrgStructuralTreeContext = {
  treeRows: OrgTreeRow[];
  remapMemberId: (id: string) => string;
  remapCustomerMemberId: (
    customerId: string,
    expectedName?: string | null,
    customerPhone?: string | null,
  ) => string;
  resolveContractSalesMemberId: (c: ContractSalesRemapInput) => string;
  resolveSettlementWalkSalesMemberId: (
    c: ContractSalesRemapInput & { settlement_sales_member_id?: string | null },
  ) => string;
  hqIds: Set<string>;
  membersFiltered: OrgMemberForContractRemap[];
};

/**
 * /admin/organization 과 동일한 구조 트리(고객 노드 병합·edge dedup)와 계약 귀속 함수.
 * 정산 승격 walk·동기화 승격 판정에서 조직도와 같은 산하·귀속 기준을 쓴다.
 */
export function buildOrgStructuralTreeContext(params: {
  membersRaw: OrgMemberForContractRemap[];
  edgesRaw: Array<{ parent_id: string | null; child_id: string }>;
  /** member_id → override parent_id (코드 선발급 예외 연결 등) */
  parentOverrideByChildId?: ReadonlyMap<string, string | null>;
}): OrgStructuralTreeContext {
  const { membersRaw, edgesRaw, parentOverrideByChildId } = params;

  const remapCtx = buildOrgContractSalesRemap(membersRaw);
  const {
    remapMemberId,
    resolveContractSalesMemberId,
    remapCustomerMemberId,
    hqIds,
    membersFiltered,
  } = remapCtx;

  const memberIdSet = new Set(membersFiltered.map((m) => m.id));

  const edges = edgesRaw.map((e) => ({
    parent_id: e.parent_id ? remapMemberId(e.parent_id) : null,
    child_id: remapMemberId(e.child_id),
  }));

  const bestByChild = new Map<string, { parent_id: string | null; child_id: string }>();
  const isBetter = (
    next: { parent_id: string | null; child_id: string },
    prev: { parent_id: string | null; child_id: string },
  ): boolean => {
    const nextIsHq = next.parent_id != null && hqIds.has(next.parent_id);
    const prevIsHq = prev.parent_id != null && hqIds.has(prev.parent_id);
    if (nextIsHq !== prevIsHq) return nextIsHq;
    if ((next.parent_id != null) !== (prev.parent_id != null)) return next.parent_id != null;
    return false;
  };

  for (const e of edges) {
    const parent_id = e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null;
    const child_id = e.child_id;
    if (!memberIdSet.has(child_id)) continue;
    const next = { parent_id, child_id };
    const prev = bestByChild.get(child_id);
    if (!prev || isBetter(next, prev)) bestByChild.set(child_id, next);
  }

  const edgeMap = new Map<string, string | null>();
  for (const e of bestByChild.values()) {
    edgeMap.set(e.child_id, e.parent_id);
  }
  if (parentOverrideByChildId) {
    for (const [childId, parentId] of parentOverrideByChildId) {
      if (!memberIdSet.has(childId)) continue;
      // parent는 존재하지 않으면 null로 처리(본사 직속) — 저장 단계에서 검증한다.
      edgeMap.set(childId, parentId ?? null);
    }
  }

  const treeRows: OrgTreeRow[] = membersFiltered.map((m) => ({
    id: m.id,
    name: m.name,
    rank: m.rank as OrgTreeRow['rank'],
    parent_id: m.rank === '본사' ? null : (edgeMap.get(m.id) ?? null),
    depth: 0,
  }));

  const resolveSettlementWalkSalesMemberId = (
    c: ContractSalesRemapInput & { settlement_sales_member_id?: string | null },
  ): string => {
    const effective = (c.settlement_sales_member_id ?? c.sales_member_id) as string;
    return resolveContractSalesMemberId({
      ...c,
      sales_member_id: effective,
    });
  };

  return {
    treeRows,
    remapMemberId,
    remapCustomerMemberId,
    resolveContractSalesMemberId,
    resolveSettlementWalkSalesMemberId,
    hqIds,
    membersFiltered,
  };
}
