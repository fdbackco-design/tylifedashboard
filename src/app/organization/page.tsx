import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import OrgTree from '@/components/org-tree/OrgTree';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { collectSubtreeMemberIdsDownstream } from '@/lib/settlement/settlement-org-tree';
import { getSettlementWindowForYearMonth, getSettlementWindowSeoul } from '@/lib/settlement/settlement-window';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import type { OrgTreeRow } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import { buildChildrenByParentFromRows } from '@/lib/settlement/settlement-org-tree';

export const metadata: Metadata = { title: '내 조직도' };
export const dynamic = 'force-dynamic';

export default async function OrganizationMyTreePage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string; debug?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const debugEnabled = sp.debug === '1';

  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonth = sp.year_month ?? defaultYearMonth;
  const yearMonth = /^\d{4}-\d{2}$/.test(requestedYearMonth) ? requestedYearMonth : defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);

  // user session은 anon+RLS 클라이언트로 읽어야 한다.
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();

  // organization_members/edges 등은 현재 RLS 정책이 없어서 service_role로 읽는다.
  // 대신 subtree 필터링으로 범위를 엄격히 제한한다.
  const adminDb = createAdminSupabaseClient();

  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`);
  }

  const { data: profile, error: profileErr } = await userDb
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    redirect(`/login?error=profile&redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`);
  }

  const memberId = profile?.member_id as string | null;
  const debugStats: Record<string, unknown> = {
    debugEnabled,
    user_id: user?.id ?? null,
    profile_member_id: memberId,
    yearMonth,
    settlementWindow: { start_date, end_date, label_year_month },
  };

  if (!memberId) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600">이 계정은 조직도에 연결된 권한(member_id)이 없습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    );
  }

  const months: string[] = [];
  {
    const [ys, ms] = label_year_month.split('-');
    const baseY = parseInt(ys, 10);
    const baseM = parseInt(ms, 10);
    for (let i = 0; i < 12; i++) {
      const d = new Date(baseY, baseM - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }

  const monthHref = (m: string): string => {
    const qs = new URLSearchParams();
    qs.set('year_month', m);
    if (debugEnabled) qs.set('debug', '1');
    return `/organization?${qs.toString()}`;
  };

  // 공통: 조직 구성 + 계약(서브트리 기준)
  const [membersRes, edgesRes, rulesRes, contractsRes] = await Promise.all([
    adminDb
      .from('organization_members')
      .select('id,name,rank,phone,external_id,source_customer_id'),
    // 개인 조직도는 member_id 중심 서브트리만 필터링하므로,
    // 여기서는 is_active 필터를 제거하고 서버에서 subtree 기준으로만 범위를 제한한다.
    adminDb.from('organization_edges').select('parent_id,child_id'),
    adminDb.from('settlement_rules').select('*'),
    adminDb
      .from('contracts')
      .select(
        'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, sales_member_id, is_cancelled, customers(name, phone)',
      )
      .not('sales_member_id', 'is', null)
      .gte('join_date', start_date)
      // endExclusive 계산은 프론트/기존 util과 동일하게 더 엄격히 맞추지 않고, join_date<=end_date 방식으로 처리
      .lte('join_date', end_date)
      .order('join_date', { ascending: false })
      .limit(20000),
  ]);

  const membersRaw = (((membersRes.data ?? []) as unknown as any[]) ?? []).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  ) as Array<{
    id: string;
    name: string;
    rank: any;
    phone: string | null;
    external_id: string | null;
    source_customer_id: string | null;
  }>;
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;
  const rules = (rulesRes.data ?? []) as SettlementRule[];

  debugStats.members_raw_count = membersRaw.length;
  debugStats.edges_raw_count = (edgesRes.data ?? []).length;

  // treeRows 기준으로 서브트리 계산
  const treeRowsBase: OrgTreeRow[] = membersRaw.map((m) => ({
    id: m.id,
    name: m.name,
    rank: m.rank,
    parent_id: m.rank === '본사' ? null : null,
    depth: 0,
  }));
  const edgeByChild = new Map<string, string | null>();
  for (const e of edgesRaw) edgeByChild.set(e.child_id, e.parent_id);

  const treeRows = treeRowsBase.map((r) => ({
    ...r,
    parent_id: r.rank === '본사' ? null : edgeByChild.get(r.id) ?? null,
  }));

  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtreeIds = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);

  const subtreeMembers = membersRaw.filter((m) => subtreeIds.has(m.id));
  const subtreeIdSet = new Set(subtreeMembers.map((m) => m.id));
  debugStats.subtree_ids_count = subtreeIds.size;
  debugStats.subtree_members_count = subtreeMembers.length;

  // subtree parent는 “parent가 subtree 밖이면 root 처리(=parent null)”
  const subtreeTreeRows: OrgTreeRow[] = treeRows
    .filter((r) => subtreeIdSet.has(r.id))
    .map((r) => {
      const pid = r.parent_id ?? null;
      return { ...r, parent_id: pid && subtreeIdSet.has(pid) ? pid : null };
    });
  debugStats.subtree_tree_rows_count = subtreeTreeRows.length;

  const tree = buildOrgTree(subtreeTreeRows);
  debugStats.tree_roots_count = tree.length;
  debugStats.tree_root_ids = tree.map((r: any) => r.id);

  const eligibleContractsForMetrics = (contractsRes.data ?? [])
    .filter((c) => {
      const joinDate = (c as any).join_date ? String((c as any).join_date).slice(0, 10) : '';
      // join_date window은 이미 쿼리에서 좁혔지만, 혹시 모를 날짜 형태 차이를 방어
      if (!joinDate) return false;
      return true;
    })
    .filter(isSettlementEligibleContract)
    .map((c) => ({
      contract_id: (c as any).id as string,
      join_date: String((c as any).join_date ?? '').slice(0, 10),
      unit_count: (c as any).unit_count ?? 0,
      status: (c as any).status as string,
      item_name: (c as any).item_name ?? null,
      sales_member_id: (c as any).sales_member_id as string,
    }));
  debugStats.eligible_contracts_for_metrics_count = eligibleContractsForMetrics.length;

  const contractsByMember: Record<string, ContractItem[]> = {};
  for (const c of contractsRes.data ?? []) {
    const salesMid = (c as any).sales_member_id as string | null;
    if (!salesMid) continue;
    if (!subtreeIdSet.has(salesMid)) continue;

    const displayStatus = getContractDisplayStatus({
      status: (c as any).status as string,
      rental_request_no: (c as any).rental_request_no ?? null,
      invoice_no: (c as any).invoice_no ?? null,
      memo: (c as any).memo ?? null,
    });

    // OrgTree는 화면 상태를 직접 판단하진 않기 때문에, item.status를 그대로 전달(=DB status)
    if (!contractsByMember[salesMid]) contractsByMember[salesMid] = [];
    contractsByMember[salesMid].push({
      id: (c as any).id as string,
      contract_code: (c as any).contract_code as string,
      join_date: (c as any).join_date ? String((c as any).join_date).slice(0, 10) : null,
      product_type: (c as any).product_type ?? null,
      item_name: (c as any).item_name ?? null,
      rental_request_no: (c as any).rental_request_no ?? null,
      invoice_no: (c as any).invoice_no ?? null,
      memo: (c as any).memo ?? null,
      status: (c as any).status as string,
      unit_count: (c as any).unit_count ?? null,
      customer_name: (c as any).customers?.name ?? '',
    });
  }
  debugStats.contracts_by_member_keys = Object.keys(contractsByMember).slice(0, 30);
  debugStats.contracts_by_member_total_rows = Object.values(contractsByMember).reduce((s, arr) => s + arr.length, 0);

  // edges/subtree는 calculateOrgNodeMetrics에 넣을 때도 서브트리만 유지
  const subtreeEdges = edgesRaw.filter((e) => e.child_id && subtreeIdSet.has(e.child_id) && e.parent_id && subtreeIdSet.has(e.parent_id));
  const orgMetricsById = calculateOrgNodeMetrics({
    roots: tree as any[],
    members: subtreeMembers.map((m) => ({ id: m.id, rank: m.rank })),
    edges: subtreeEdges.map((e) => ({ parent_id: e.parent_id, child_id: e.child_id })),
    treeRows: subtreeTreeRows,
    attributeCommissionToTopLineUnderHq: false,
    contracts: eligibleContractsForMetrics as any[],
    rules,
    settlementWindow: { start_date, end_date, label_year_month },
  });

  return (
    <div className="p-6">
      {debugEnabled ? (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
          <div className="text-sm font-semibold text-slate-800 mb-2">[organization debug] stats</div>
          <pre className="text-[11px] leading-4 text-slate-700 whitespace-pre-wrap">
            {JSON.stringify(debugStats, null, 2)}
          </pre>
        </div>
      ) : null}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">내 조직도</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            기준 {label_year_month} · {start_date}~{end_date}
          </p>
        </div>
      </div>

      {/* 월 선택 */}
      <div className="flex gap-1 mb-5 flex-wrap items-center">
        <Link
          href={monthHref(label_year_month)}
          className={`px-2.5 py-1 rounded text-xs border ${
            label_year_month === yearMonth ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
          }`}
        >
          오늘(기준월)
        </Link>
        {months.map((m) => (
          <Link
            key={m}
            href={monthHref(m)}
            className={`px-2.5 py-1 rounded text-xs border ${
              m === yearMonth ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            {m.slice(5)}월
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <OrgTree
          roots={tree as any}
          contractsByMember={contractsByMember}
          metricsById={orgMetricsById as any}
          debug={
            debugEnabled
              ? ({ enabled: true } as any)
              : ({ enabled: false, hqId: null, hqEligibleTotal: 0, hqEligibleMappedToCustomerNode: 0, hqEligibleMissingCustomerNode: 0 } as any)
          }
        />
      </div>
    </div>
  );
}

