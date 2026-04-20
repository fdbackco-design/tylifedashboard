import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';

/**
 * /settlement 페이지와 동일: 본사 루트 + source_customer_id 직속 본사 연결 등 반영
 */
export function buildSettlementTreeRows(
  membersRaw: Array<{
    id: string;
    name: string;
    rank: RankType;
    source_customer_id?: string | null;
  }>,
  edgesRaw: Array<{ parent_id: string | null; child_id: string }>,
): OrgTreeRow[] {
  const hqIdsRaw = new Set(
    membersRaw.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id as string),
  );
  const hqIdForTree =
    membersRaw.find((m) => m.name === '안성준')?.id ?? (hqIdsRaw.values().next().value ?? null);

  const memberIdSet = new Set(membersRaw.map((m) => m.id as string));
  const edgeMap = new Map<string, string | null>();
  for (const e of edgesRaw) {
    const parent_id = e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null;
    if (!memberIdSet.has(e.child_id)) continue;
    edgeMap.set(e.child_id, parent_id);
  }

  return membersRaw.map((m) => ({
    id: m.id as string,
    name: m.name as string,
    rank: m.rank as RankType,
    parent_id:
      m.rank === '본사'
        ? null
        : hqIdForTree && (m.source_customer_id ?? null) != null
          ? hqIdForTree
          : (edgeMap.get(m.id as string) ?? null),
    depth: 0,
  }));
}

export function buildChildrenByParentFromRows(rows: OrgTreeRow[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parent_id) continue;
    const list = m.get(r.parent_id) ?? [];
    list.push(r.id);
    m.set(r.parent_id, list);
  }
  return m;
}

/** root 포함: root 자신 + 모든 하위 member id */
export function collectSubtreeMemberIdsDownstream(
  rootId: string,
  childrenByParent: Map<string, string[]>,
): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const ch of childrenByParent.get(id) ?? []) stack.push(ch);
  }
  return out;
}
