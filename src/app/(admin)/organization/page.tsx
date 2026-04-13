import type { Metadata } from 'next';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import OrgTreeNode from '@/components/org-tree/OrgTreeNode';
import type { OrgTreeRow, OrganizationMember } from '@/lib/types';

export const metadata: Metadata = { title: '조직도' };
export const dynamic = 'force-dynamic';

export default async function OrganizationPage() {
  const db = createAdminSupabaseClient();

  const [membersRes, edgesRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank')
      .eq('is_active', true)
      .order('name'),
    db.from('organization_edges').select('parent_id, child_id'),
  ]);

  const members = (membersRes.data ?? []) as OrganizationMember[];
  const edges = edgesRes.data ?? [];

  const edgeMap = new Map<string, string | null>();
  for (const e of edges) {
    edgeMap.set(
      (e as { child_id: string }).child_id,
      (e as { parent_id: string | null }).parent_id,
    );
  }

  const treeRows: OrgTreeRow[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    rank: m.rank,
    parent_id: edgeMap.get(m.id) ?? null,
    depth: 0,
  }));

  const tree = buildOrgTree(treeRows);

  // 직급별 카운트
  const rankCounts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.rank] = (acc[m.rank] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">조직도</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          총 {members.length}명 · 접기/펼치기로 계층 탐색
        </p>
      </div>

      {/* 직급별 현황 */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {Object.entries(rankCounts).map(([rank, count]) => (
          <div
            key={rank}
            className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-sm shadow-sm"
          >
            <span className="text-gray-500">{rank}</span>
            <span className="ml-2 font-bold text-gray-800">{count}명</span>
          </div>
        ))}
      </div>

      {/* 조직 트리 */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        {tree.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            조직 데이터가 없습니다. 동기화를 먼저 실행하세요.
          </p>
        ) : (
          tree.map((root) => <OrgTreeNode key={root.id} node={root} depth={0} />)
        )}
      </div>
    </div>
  );
}
