import type { Metadata } from 'next';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import OrgTree from '@/components/org-tree/OrgTree';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import type { OrgTreeRow, OrganizationMember } from '@/lib/types';
import SyncButton from './SyncButton';

export const metadata: Metadata = { title: '조직도' };
export const dynamic = 'force-dynamic';

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '진행 중';
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${ms}ms`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function OrganizationPage() {
  const db = createAdminSupabaseClient();

  const [membersRes, edgesRes, contractCountRes, lastSyncRes, contractsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank')
      .eq('is_active', true)
      .order('name'),
    db.from('organization_edges').select('parent_id, child_id'),
    db.from('contracts').select('id', { count: 'exact', head: true }),
    db
      .from('sync_runs')
      .select('id, status, triggered_by, started_at, finished_at, total_fetched, total_created, total_updated, total_errors')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('contracts')
      .select('id, contract_code, join_date, product_type, status, unit_count, sales_member_id, customers(name)')
      .not('sales_member_id', 'is', null),
  ]);

  // 안성준은 TY Life 시스템상 영업사원이지만 실제로는 본사(최상위)로 취급
  const members = ((membersRes.data ?? []) as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edges = edgesRes.data ?? [];
  const contractCount = contractCountRes.count ?? 0;
  const lastSync = lastSyncRes.data as {
    id: string;
    status: string;
    triggered_by: string;
    started_at: string;
    finished_at: string | null;
    total_fetched: number | null;
    total_created: number | null;
    total_updated: number | null;
    total_errors: number | null;
  } | null;

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

  // 계약 데이터 → 멤버별 맵
  const contractsByMember: Record<string, ContractItem[]> = {};
  for (const _c of (contractsRes.data ?? [])) {
    const c = _c as unknown as {
      id: string;
      contract_code: string;
      join_date: string | null;
      product_type: string | null;
      status: string;
      unit_count: number | null;
      sales_member_id: string;
      customers: { name: string } | null;
    };
    const key = c.sales_member_id;
    if (!contractsByMember[key]) contractsByMember[key] = [];
    contractsByMember[key].push({
      id: c.id,
      contract_code: c.contract_code,
      join_date: c.join_date,
      product_type: c.product_type,
      status: c.status,
      unit_count: c.unit_count,
      customer_name: c.customers?.name ?? '',
    });
  }

  const tree = buildOrgTree(treeRows);

  // 직급별 카운트
  const rankCounts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.rank] = (acc[m.rank] ?? 0) + 1;
    return acc;
  }, {});

  const statusColor: Record<string, string> = {
    completed: 'text-green-600',
    failed: 'text-red-500',
    running: 'text-yellow-600',
  };

  const statusLabel: Record<string, string> = {
    completed: '완료',
    failed: '실패',
    running: '진행 중',
  };

  return (
    <div className="p-6">
      {/* 헤더 + 동기화 버튼 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">조직도</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            총 {members.length}명 · 계약 {contractCount.toLocaleString()}건 저장됨
          </p>
        </div>
        <SyncButton />
      </div>

      {/* 마지막 동기화 상태 */}
      {lastSync ? (
        <div className="mb-5 flex items-center gap-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
          <span className="font-medium text-gray-700">마지막 동기화</span>
          <span>{formatDateTime(lastSync.started_at)}</span>
          <span
            className={`font-semibold ${statusColor[lastSync.status] ?? 'text-gray-600'}`}
          >
            {statusLabel[lastSync.status] ?? lastSync.status}
          </span>
          {lastSync.finished_at && (
            <span>{formatDuration(lastSync.started_at, lastSync.finished_at)}</span>
          )}
          {lastSync.total_fetched != null && (
            <span>
              조회 {lastSync.total_fetched}건 · 신규 {lastSync.total_created ?? 0} · 갱신{' '}
              {lastSync.total_updated ?? 0}
              {(lastSync.total_errors ?? 0) > 0 && (
                <span className="text-red-500"> · 오류 {lastSync.total_errors}</span>
              )}
            </span>
          )}
        </div>
      ) : (
        <div className="mb-5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
          동기화 기록이 없습니다. 오른쪽 상단 버튼으로 TY Life 데이터를 가져오세요.
        </div>
      )}

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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        {members.length > 0 && tree.length === 0 && (
          <p className="text-xs text-amber-600 mb-4 text-center">
            {members.length}명이 있지만 조직 계층 연결(edges)이 없습니다. 상하위 관계를 등록하면 트리로 표시됩니다.
          </p>
        )}
        <OrgTree roots={tree} contractsByMember={contractsByMember} />
      </div>
    </div>
  );
}
