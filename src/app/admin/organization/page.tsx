import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { BASE_AMOUNT_PER_UNIT } from '@/lib/settlement/constants';
import {
  coalesceYearMonthSearchParam,
  contractJoinYmdInInclusiveWindow,
  getSettlementWindowForYearMonth,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isSettlementEligibleContract } from '@/lib/settlement/settlement-eligibility';
import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import OrgTree from '@/components/org-tree/OrgTree';
import YearMonthSelector from '@/components/YearMonthSelector';
import {
  flattenOrgTreeNodes,
  stripOrgTreeNodesForDisplay,
} from '@/lib/organization/org-tree-display';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import type { OrgTreeRow, OrganizationMember } from '@/lib/types';
import {
  computeSalesMemberPromotionThreshold,
  type AttributedJoinContractRow,
} from '@/lib/settlement/leader-promotion';
import SyncButton from './SyncButton';
// 조직도 기준 정산 담당자 자동 보정 패널 — 현재 UI 에서는 숨김 처리.
// 컴포넌트 자체는 보존 (필요 시 다시 노출 가능).
// import SettlementSalesMemberOverridePanel from './SettlementSalesMemberOverridePanel';

export const metadata: Metadata = { title: '조직도' };
export const dynamic = 'force-dynamic';

function formatWon(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

/** 모바일 등에서 금액을 짧게 표시 (원 단위는 title 등으로 병기) */
function formatWonShort(value: number): string {
  const v = Math.round(Number(value) || 0);
  if (!Number.isFinite(v) || v === 0) return '0원';
  const eok = Math.floor(v / 100_000_000);
  const man = Math.round((v % 100_000_000) / 10_000);
  if (eok > 0 && man > 0) return `${eok.toLocaleString('ko-KR')}억 ${man.toLocaleString('ko-KR')}만원`;
  if (eok > 0) return `${eok.toLocaleString('ko-KR')}억원`;
  if (man >= 1) return `${man.toLocaleString('ko-KR')}만원`;
  return `${v.toLocaleString('ko-KR')}원`;
}

function formatSyncBarTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const pick = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value?.padStart(2, '0') ?? '';
  return `${pick('month')}.${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const db = createAdminSupabaseClient();

  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;
  const { start_date, end_date, label_year_month } = getSettlementWindowForYearMonth(yearMonth);

  const yearsForPicker = (() => {
    const base = parseInt(label_year_month.slice(0, 4), 10);
    const out: number[] = [];
    for (let y = base; y >= base - 4; y--) out.push(y);
    return out;
  })();

  const [membersRes, edgesRes, contractCountRes, lastSyncRes, contractsRes, kpiRes, rulesRes, promoEventsRes] =
    await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id, leader_rank_effective_at, monthly_target_units')
      .eq('is_active', true)
      .order('name'),
    db.from('organization_edges').select('parent_id, child_id'),
    db.from('contracts').select('id', { count: 'estimated', head: true }),
    db
      .from('sync_runs')
      .select('id, status, triggered_by, started_at, finished_at, total_fetched, total_created, total_updated, total_errors')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('contracts')
      .select(
        'id, contract_code, join_date, product_type, item_name, rental_request_no, invoice_no, memo, status, unit_count, customer_id, sales_member_id, is_cancelled, sales_link_status, happy_call_at, happycall_result, created_at, customers(name, phone)',
      )
      .not('sales_member_id', 'is', null)
      .order('join_date', { ascending: false })
      .limit(20000),
    db.rpc('get_organization_kpis', { p_start_date: start_date, p_end_date: end_date }),
    db.from('settlement_rules').select('*'),
    db
      .from('leader_promotion_events')
      .select(
        'member_id, previous_parent_id, leader_maintenance_bonus_paid_year_month, threshold_contract_id, threshold_join_date',
      ),
  ]);

  // 안성준은 TY Life 시스템상 영업사원이지만 실제로는 본사(최상위)로 취급
  const membersRaw = ((membersRes.data ?? []) as unknown as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edgesRaw = edgesRes.data ?? [];
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

  // ── 고객 노드(customer:*)와 실제 영업사원 노드 병합(표시/집계용) ──
  // 같은 사람(이름+전화)이 customer 노드와 직원 노드로 동시에 존재하면,
  // 조직도에서는 하나의 노드로 합쳐 보여주기 위해 customer 노드를 직원 노드로 병합한다.
  const toPhoneDigits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');
  const normName = (v: string | null | undefined): string => (v ?? '').replace(/^\[고객\]\s*/, '').trim();

  const employeesByKey = new Map<string, string>(); // name|phone -> memberId (non-customer)
  const customerMergeTo = new Map<string, string>(); // customerMemberId -> employeeMemberId
  const customerIdToEffectiveMemberId = new Map<string, string>(); // customer:{customer_id} -> (customerMemberId or merged employeeMemberId)
  const hqIdsRaw = new Set(
    (membersRaw as any[])
      .filter((m) => (m as any).name === '안성준' || (m as any).rank === '본사')
      .map((m) => (m as any).id as string),
  );
  const hqIdForTree =
    membersRaw.find((m: any) => m.name === '안성준')?.id ?? (hqIdsRaw.values().next().value ?? null);

  for (const m of membersRaw as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    const nName = normName((m as any).name);
    const digits = toPhoneDigits((m as any).phone);
    const key = `${nName}|${digits}`;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode && toPhoneDigits((m as any).phone)) {
      // 직원 노드 우선 등록
      if (!employeesByKey.has(key)) employeesByKey.set(key, (m as { id: string }).id);
    }
  }

  for (const m of membersRaw as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode) continue;
    const digits = toPhoneDigits((m as any).phone);
    const nName = normName((m as any).name);
    if (digits) {
      const key = `${nName}|${digits}`;
      const employeeId = employeesByKey.get(key);
      if (employeeId) {
        customerMergeTo.set((m as { id: string }).id, employeeId);
        continue;
      }
    }
  }

  const remapMemberId = (id: string): string => customerMergeTo.get(id) ?? id;

  // customer_id → organization_member 매핑은 (1) source_customer_id (2) external_id=customer:* 순서로 본다.
  // 또한 customer 노드가 직원 노드로 병합되어 members에서 제외돼도, 계약 origin 치환이 가능해야 한다.
  for (const m of membersRaw as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    const sourceCustomerId = ((m as any).source_customer_id ?? null) as string | null;
    if (sourceCustomerId) {
      customerIdToEffectiveMemberId.set(sourceCustomerId, remapMemberId((m as { id: string }).id));
      continue;
    }
    if (ext && ext.startsWith('customer:')) {
      const customerId = ext.slice('customer:'.length);
      customerIdToEffectiveMemberId.set(customerId, remapMemberId((m as { id: string }).id));
    }
  }

  const members = membersRaw.filter((m: any) => !customerMergeTo.has((m as { id: string }).id));
  const memberIdSet = new Set((members as any[]).map((m) => (m as { id: string }).id));
  const memberNameById = new Map(
    (members as any[]).map((m) => [(m as { id: string }).id, normName((m as { name: string }).name)]),
  );
  const salesMemberDisplayName = (salesMemberId: string | null | undefined): string => {
    const id = remapMemberId(String(salesMemberId ?? ''));
    if (!id) return '-';
    return memberNameById.get(id) ?? '-';
  };
  const edges = (edgesRaw as any[]).map((e) => ({
    parent_id: (e as any).parent_id ? remapMemberId((e as any).parent_id) : null,
    child_id: remapMemberId((e as any).child_id),
  }));

  // child_id UNIQUE 성격 유지: remap으로 중복된 child가 생기면 "더 적절한 parent"를 선택
  // - 본사(hq) 아래로 붙는 edge가 있으면 그걸 우선
  // - 그 외에는 parent_id가 null이 아닌 것을 우선
  const bestByChild = new Map<string, { parent_id: string | null; child_id: string }>();
  const isBetter = (
    next: { parent_id: string | null; child_id: string },
    prev: { parent_id: string | null; child_id: string },
  ): boolean => {
    const nextIsHq = next.parent_id != null && hqIdsRaw.has(next.parent_id);
    const prevIsHq = prev.parent_id != null && hqIdsRaw.has(prev.parent_id);
    if (nextIsHq !== prevIsHq) return nextIsHq;
    if ((next.parent_id != null) !== (prev.parent_id != null)) return next.parent_id != null;
    return false;
  };

  for (const e of edges as any[]) {
    // remap 이후 parent가 존재하지 않으면(병합/삭제로 유실) 루트로 승격
    const parent_id = e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null;
    const child_id = e.child_id as string;
    if (!memberIdSet.has(child_id)) continue;

    const next = { parent_id, child_id };
    const prev = bestByChild.get(child_id);
    if (!prev || isBetter(next, prev)) bestByChild.set(child_id, next);
  }

  const dedupedEdges = [...bestByChild.values()];

  const edgeMap = new Map<string, string | null>();
  for (const e of dedupedEdges) {
    edgeMap.set(
      (e as { child_id: string }).child_id,
      (e as { parent_id: string | null }).parent_id,
    );
  }

  const treeRowsBase: OrgTreeRow[] = members.map((m: any) => ({
    id: m.id,
    name: m.name,
    rank: m.rank,
    parent_id:
      // 트리 최상단 본사 노드는 언제나 루트로 고정
      m.rank === '본사'
        ? null
        : (edgeMap.get(m.id) ?? null),
    depth: 0,
  }));

  // 계약 데이터 → 멤버별 맵 (표시용: 담당자 있는 전체 계약)
  const contractsByMember: Record<string, ContractItem[]> = {};
  const rawContractRows = (contractsRes.data ?? []) as unknown as Array<{
    id: string;
    contract_code: string;
    join_date: string | null;
    product_type: string | null;
    item_name?: string | null;
    rental_request_no?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    status: string;
    unit_count: number | null;
    customer_id: string;
    sales_member_id: string;
    is_cancelled?: boolean | null;
    sales_link_status?: string | null;
    happy_call_at?: string | null;
    happycall_result?: string | null;
    customers: { name: string; phone: string | null } | null;
    created_at?: string | null;
  }>;

  // treeRows는 기본적으로 DB edges + 표시 규칙으로 구성하되,
  // 아래에서 정책 승격 결과로 parent/rank를 오버라이드할 수 있으므로 let으로 둔다.
  let treeRows: OrgTreeRow[] = treeRowsBase;

  // 예외 규칙(최종):
  // "안성준(본사) 담당 + 가입 인정 기준" 계약은 동기화 단계에서
  // customer:{customer_id} 노드가 생성/연결되므로, 여기서는 그 노드로 origin을 치환한다.
  const hqIds = new Set(
    (members as any[])
      .filter((m) => m.name === '안성준' || m.rank === '본사')
      .map((m) => m.id),
  );
  const customerNodeByCustomerId = new Map<string, string>(); // external_id = customer:{customer_id}
  const customerMemberIdByCustomerId = new Map<string, string>(); // (customer node) customer_id -> member id (source_customer_id 우선)
  const nodeIdByPhoneDigits = new Map<string, string>(); // phone digits -> member id

  for (const m of members as any[]) {
    const ext = (m as { external_id?: string | null }).external_id ?? null;
    if (ext && ext.startsWith('customer:')) {
      const customerId = ext.slice('customer:'.length);
      customerNodeByCustomerId.set(customerId, (m as { id: string }).id);
    }
    const sid = ((m as any).source_customer_id ?? null) as string | null;
    if (sid && (m as any).rank !== '본사') {
      customerMemberIdByCustomerId.set(sid, (m as { id: string }).id);
    } else if (ext && ext.startsWith('customer:') && (m as any).rank !== '본사') {
      // source_customer_id가 없더라도 customer:* 노드는 customer_id로 매핑 가능
      const customerId = ext.slice('customer:'.length);
      if (!customerMemberIdByCustomerId.has(customerId)) {
        customerMemberIdByCustomerId.set(customerId, (m as { id: string }).id);
      }
    }
    const digits = toPhoneDigits((m as { phone?: string | null }).phone ?? null);
    if (digits) nodeIdByPhoneDigits.set(digits, (m as { id: string }).id);
  }

  const findCustomerNodeId = (c: { customer_id: string; customer_phone: string | null }): string | null => {
    // (1) external_id == customer:{customer_id} (SSOT) — 병합 결과(직원 노드)까지 포함
    const byExt = customerIdToEffectiveMemberId.get(c.customer_id) ?? customerNodeByCustomerId.get(c.customer_id);
    if (byExt) return byExt;
    // (2) fallback: phone match (과거 데이터/임시 노드 보정용)
    const digits = toPhoneDigits(c.customer_phone);
    if (digits) {
      const byPhone = nodeIdByPhoneDigits.get(digits);
      if (byPhone) return byPhone;
    }
    return null;
  };

  const mapSalesMemberForOrg = (c: {
    sales_member_id: string;
    customer_id: string;
    status: string;
    rental_request_no?: string | null;
    invoice_no?: string | null;
    memo?: string | null;
    customer_phone: string | null;
    contract_code?: string | null;
    customer_name?: string | null;
  }): string => {
    // 정책: customer 노드(본사 직계약 고객/가상 영업사원)는 "본인이 고객인 계약"을 본인에게 귀속해 보여준다.
    // (담당자가 누구든 customer_id가 매핑되면 해당 customer 노드의 직접 계약으로 간주)
    const customerMemberId = customerMemberIdByCustomerId.get(c.customer_id) ?? null;
    if (customerMemberId) return customerMemberId;

    // 동기화 타이밍/원본 상태 문자열 때문에 status가 '가입'으로 안 찍히는 경우가 있어도,
    // “가입 인정 기준(해약 아님 + 송장/렌탈 존재)”이면 가입으로 간주해서 예외를 항상 적용한다.
    const joinEligible = isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });

    if (hqIds.size > 0 && hqIds.has(c.sales_member_id) && joinEligible) {
      const customerNodeId = findCustomerNodeId({ customer_id: c.customer_id, customer_phone: c.customer_phone });
      if (customerNodeId) {
        return customerNodeId;
      }
    }
    return c.sales_member_id;
  };

  // ── 정책 승격(산하 가입 누적 20구좌)으로 "본사 직속 재배치"를 조직도 UI에도 즉시 반영 ──
  // - 동기화/정산 재계산을 안 돌려도, 조직도 페이지에서 승격 조건을 만족하면 본사 직속으로 보이게 한다.
  // - 단, DB organization_edges는 여기서 변경하지 않고(페이지 렌더는 읽기 전용 유지),
  //   트리 구성 시에만 parent/rank를 오버라이드한다.
  {
    const rankByIdForThreshold = new Map<string, any>();
    for (const m of members as any[]) {
      // threshold 계산은 영업사원만 대상으로 하므로, '리더'도 임시로 영업사원 취급(정책 승격 후 rank가 올라간 경우 대비)
      rankByIdForThreshold.set(m.id as string, (m.rank === '리더' ? '영업사원' : m.rank) as any);
    }

    const joinAttributedForThreshold: AttributedJoinContractRow[] = rawContractRows
      .filter((c) => (c.sales_link_status ?? 'linked') === 'linked')
      .filter((c) => !c.is_cancelled)
      .filter((c) =>
        isContractJoinCompleted({
          status: c.status,
          rental_request_no: c.rental_request_no ?? null,
          invoice_no: c.invoice_no ?? null,
          memo: c.memo ?? null,
        }),
      )
      .map((c) => ({
        id: c.id,
        join_date: String(c.join_date ?? '').slice(0, 10),
        unit_count: c.unit_count ?? 0,
        // 조직도와 동일한 귀속 정책(고객 노드 치환/HQ 치환 등) 반영
        sales_member_id: remapMemberId(
          mapSalesMemberForOrg({
            sales_member_id: c.sales_member_id,
            customer_id: c.customer_id,
            status: c.status,
            rental_request_no: c.rental_request_no ?? null,
            invoice_no: c.invoice_no ?? null,
            memo: c.memo ?? null,
            customer_phone: c.customers?.phone ?? null,
            contract_code: c.contract_code,
            customer_name: c.customers?.name ?? '',
          }),
        ),
        created_at: (c as { created_at?: string | null }).created_at ?? null,
      }));

    const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(
      treeRowsBase,
      joinAttributedForThreshold,
      rankByIdForThreshold as any,
    );

    const rankByIdRaw = new Map<string, string>();
    for (const m of members as any[]) rankByIdRaw.set(m.id as string, String(m.rank));

    treeRows = treeRowsBase.map((r) => {
      if (r.rank === '본사') return r;
      const th = promotionThresholdByMemberId.get(r.id) ?? null;
      if (!th || !hqIdForTree) return r;

      // 승격자는 조직도 배지/정렬에서도 리더로 보이게(요구: 원본 rank가 아니라 effective rank 반영)
      return { ...r, rank: '리더' as any };
    });

    // UI에서 '리더'로 보이게 되는 경우, DB의 organization_members.rank도 함께 승격 반영한다.
    // - 안전을 위해 "승격(영업사원 → 리더)"만 수행하고, 조건이 풀렸다고 해서 강등은 하지 않는다.
    // - 본사/특정 예외(안성준 본사 취급)는 DB에 쓰지 않는다.
    // - leader_promotion_events: 정산에서 승격 전 상위 리더·policy 플래그를 복원하므로, rank 업데이트와 함께 기록한다.
    try {
      const existingPromoMemberIds = new Set(
        ((promoEventsRes.data ?? []) as any[]).map((r) => String(r.member_id)),
      );

      const buildLeaderPromoEventRow = (
        memberId: string,
      ): {
        member_id: string;
        previous_parent_id: string | null;
        threshold_contract_id: string;
        threshold_join_date: string;
      } | null => {
        const th = promotionThresholdByMemberId.get(memberId) ?? null;
        if (!th) return null;
        return {
          member_id: memberId,
          previous_parent_id: edgeMap.get(memberId) ?? null,
          threshold_contract_id: th.threshold_contract_id,
          threshold_join_date: th.threshold_join_date,
        };
      };

      const promotedIds = treeRows
        .filter((r) => r.rank === '리더')
        .map((r) => r.id)
        .filter((id) => {
          const raw = rankByIdRaw.get(id) ?? null;
          if (!raw) return false;
          if (raw === '리더') return false;
          if (raw === '본사') return false;
          // 승격 대상은 기본적으로 영업사원에서 올라오는 케이스만
          return raw === '영업사원';
        });

      // 안성준(본사) 예외는 DB 업데이트에서 제외
      const ahnId = membersRaw.find((m: any) => m.name === '안성준')?.id ?? null;
      const idsToUpdate = ahnId ? promotedIds.filter((id) => id !== ahnId) : promotedIds;

      let rankUpdateErr: { message: string } | null = null;
      if (idsToUpdate.length > 0) {
        const { error } = await db
          .from('organization_members')
          .update({ rank: '리더' as any } as any)
          .in('id', idsToUpdate);
        rankUpdateErr = error ?? null;
        if (error) {
          // 페이지 렌더는 막지 않는다.
          // (서버 로그에서만 확인 가능)
          console.error('organization_members.rank 업데이트 실패:', error.message);
        }
      }

      const memberIdsNeedingPromoRow = new Set<string>();
      if (!rankUpdateErr && idsToUpdate.length > 0) {
        for (const id of idsToUpdate) memberIdsNeedingPromoRow.add(id);
      }
      // 이미 DB에 리더인데 이전 코드 때문에 leader_promotion_events 가 비어 있는 경우 보정
      for (const m of members as any[]) {
        const id = String(m.id);
        if (ahnId && id === ahnId) continue;
        if (existingPromoMemberIds.has(id)) continue;
        const raw = rankByIdRaw.get(id) ?? '';
        if (raw !== '리더') continue;
        if (!buildLeaderPromoEventRow(id)) continue;
        memberIdsNeedingPromoRow.add(id);
      }

      const promoRows = [...memberIdsNeedingPromoRow]
        .map((id) => buildLeaderPromoEventRow(id))
        .filter((row): row is NonNullable<typeof row> => row != null)
        .filter((row) => !existingPromoMemberIds.has(row.member_id));

      if (promoRows.length > 0) {
        const { error: promoErr } = await db.from('leader_promotion_events').insert(promoRows as any);
        if (promoErr) {
          console.error('leader_promotion_events 삽입 실패:', promoErr.message);
        }
      }
    } catch (e) {
      console.error('organization_members.rank 자동 승격 반영 실패:', e instanceof Error ? e.message : String(e));
    }
  }

  for (const c of rawContractRows) {
    const key = remapMemberId(mapSalesMemberForOrg({
      sales_member_id: c.sales_member_id,
      customer_id: c.customer_id,
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      customer_phone: c.customers?.phone ?? null,
      contract_code: c.contract_code,
      customer_name: c.customers?.name ?? '',
    }));
    if (!contractsByMember[key]) contractsByMember[key] = [];
    const contractItem: ContractItem = {
      id: c.id,
      contract_code: c.contract_code,
      join_date: c.join_date,
      product_type: c.product_type,
      item_name: c.item_name ?? null,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
      status: c.status,
      unit_count: c.unit_count,
      customer_name: c.customers?.name ?? '',
      sales_member_name: salesMemberDisplayName(c.sales_member_id),
    };
    contractsByMember[key].push(contractItem);

    // 표시용 보강: 담당자 기준 key와 customer 기준 key가 다르면 customer 노드에도 동일 계약을 포함시킨다.
    // (본인이 고객인 계약이 현재 노드에 포함되게)
    const customerKey = remapMemberId(customerMemberIdByCustomerId.get(c.customer_id) ?? '');
    if (customerKey && customerKey !== key) {
      if (!contractsByMember[customerKey]) contractsByMember[customerKey] = [];
      contractsByMember[customerKey].push(contractItem);
    }
  }

  const tree = buildOrgTree(treeRows);
  // 조직도(OrgTree)와 동일한 숨김·승격 후 평탄 노드 — 직급 배지·헤더 인원수 집계에 사용
  const orgTreeVisibleNodes = flattenOrgTreeNodes(stripOrgTreeNodesForDisplay(tree));
  const orgTreeVisibleCountExcludingHqRank = orgTreeVisibleNodes.filter((n) => n.rank !== '본사').length;

  /** 조직 노드 구좌·수당: get_organization_kpis 와 동일한 가입 인정 기준 */
  const kpiEligibleForMetrics = rawContractRows
    .filter(isSettlementEligibleContract)
    .map((c) => ({
      contract_id: c.id,
      join_date: c.join_date ?? '',
      unit_count: c.unit_count ?? 0,
      status: c.status,
      item_name: c.item_name ?? null,
      customer_id: c.customer_id,
      // metrics도 동일 정책: customer 노드로 귀속(origin)을 치환한다.
      sales_member_id: remapMemberId(mapSalesMemberForOrg({
        sales_member_id: c.sales_member_id,
        customer_id: c.customer_id,
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
        customer_phone: c.customers?.phone ?? null,
        contract_code: c.contract_code,
        customer_name: c.customers?.name ?? '',
      })),
      created_at: (c as { created_at?: string | null }).created_at ?? null,
    }));

  // 수당(인정/실지급) parent 체인은 트리와 동일한 단일 parent(child_id UNIQUE)를 써야 한다.
  // 원본 edges 배열을 그대로 쓰면 동일 child에 대한 중복 행 때문에 마지막 행만 남아
  // (예: E2가 C2 산하인데 A2 직속으로 잘못 잡힘) 인정수당이 과대 계산될 수 있다.
  const prevLeaderByPromotedMemberId = new Map<string, string | null>();
  const leaderMaintBlockByMemberId = new Map<string, boolean>();
  const policyPromotedMemberIdSet = new Set<string>();
  for (const r of ((promoEventsRes.data ?? []) as any[])) {
    const mid = r.member_id as string;
    policyPromotedMemberIdSet.add(mid);
    prevLeaderByPromotedMemberId.set(mid, (r.previous_parent_id ?? null) as string | null);
    const paidYm = (r.leader_maintenance_bonus_paid_year_month ?? null) as string | null;
    leaderMaintBlockByMemberId.set(mid, paidYm != null && paidYm !== label_year_month);
  }

  const thresholdPromoContractIds = [
    ...new Set(
      ((promoEventsRes.data ?? []) as any[])
        .filter((r) => r?.threshold_contract_id && r?.threshold_join_date)
        .map((r) => String(r.threshold_contract_id)),
    ),
  ];
  const leaderPromotionThresholdContractCreatedAtById = new Map<string, string | null>();
  if (thresholdPromoContractIds.length > 0) {
    const { data: thContractRows } = await db
      .from('contracts')
      .select('id, created_at')
      .in('id', thresholdPromoContractIds);
    for (const row of (thContractRows ?? []) as any[]) {
      if (!row?.id) continue;
      leaderPromotionThresholdContractCreatedAtById.set(
        String(row.id),
        (row.created_at ?? null) as string | null,
      );
    }
  }

  const orgMetricsById = calculateOrgNodeMetrics({
    roots: tree,
    // 정책 승격으로 treeRows에서 rank를 오버라이드한 경우,
    // KPI/롤업 계산도 동일한 effective rank를 보도록 members의 rank도 함께 보정한다.
    // (요구: 리더 산하에 리더가 있으면 하위로 보이고, 롤업은 직속 리더만 갖도록)
    members: (() => {
      const effectiveRankById = new Map<string, any>();
      for (const r of treeRows) effectiveRankById.set(r.id, r.rank);
      return (members as any[]).map((m) => ({
        id: (m as any).id,
        rank: (effectiveRankById.get((m as any).id) ?? (m as any).rank) as any,
        leader_rank_effective_at: (m as any).leader_rank_effective_at ?? undefined,
      }));
    })(),
    edges: dedupedEdges as { parent_id: string | null; child_id: string }[],
    treeRows,
    previousLeaderByPromotedMemberId: prevLeaderByPromotedMemberId,
    hqId: hqIdForTree,
    leaderMaintenanceBonusBlockedByMemberId: leaderMaintBlockByMemberId,
    policyPromotedMemberIdSet,
    // 조직도 화면에서는 각 노드의 수당을 그대로 표시해야 하므로,
    // "본사 직속 라인장에게 금액을 몰아주고 하위 노드를 0으로 내리는" 라인 합산 정책은 끈다.
    // (정산 현황 페이지의 라인 합계 표시용 정책과 분리)
    attributeCommissionToTopLineUnderHq: false,
    contracts: kpiEligibleForMetrics,
    rules: (rulesRes.data ?? []) as any[],
    settlementWindow: { start_date, end_date, label_year_month },
    leaderPromotionEventsForThreshold: (promoEventsRes.data ?? []) as any[],
    leaderPromotionThresholdContractCreatedAtById,
  });

  const kpiRow = ((kpiRes.data ?? [])[0] ?? null) as
    | { total_join_units: number; period_join_units: number }
    | null;
  const totalJoinUnits = kpiRow?.total_join_units ?? 0;
  const periodJoinUnits = kpiRow?.period_join_units ?? 0;

  // 이번달(정산 윈도우) 준비+대기 구좌 수 — join_date는 문자열/ISO/Date 혼재에 대비해 서울 YYYY-MM-DD로 맞춘 뒤 비교
  const periodPendingUnits = rawContractRows
    .filter((c) => contractJoinYmdInInclusiveWindow(c.join_date, start_date, end_date))
    .filter((c) => !c.is_cancelled)
    .filter((c) => String(c.status ?? '').trim() !== '해약')
    .filter((c) => {
      // 조직도 계약 리스트와 동일하게 "렌탈 미충족" 표시 상태는 제외
      const displayStatus = getContractDisplayStatus({
        status: c.status,
        rental_request_no: c.rental_request_no ?? null,
        invoice_no: c.invoice_no ?? null,
        memo: c.memo ?? null,
      });
      if (displayStatus === '렌탈 미충족') return false;
      const st = String(c.status ?? '').trim();
      return st === '준비' || st === '대기';
    })
    .reduce((sum, c) => sum + (c.unit_count ?? 0), 0);

  const totalSales = totalJoinUnits * BASE_AMOUNT_PER_UNIT;
  const periodSales = periodJoinUnits * BASE_AMOUNT_PER_UNIT;

  // 직급별 카운트: DB 전체가 아니라 조직도에 실제로 그려지는 노드(가상 본사 루트 제외, strip 반영)
  const rankCounts = orgTreeVisibleNodes.reduce<Record<string, number>>((acc, m) => {
    acc[m.rank] = (acc[m.rank] ?? 0) + 1;
    return acc;
  }, {});
  // UI 규칙: 본사는 최상단 1개로만 표시(클라이언트의 __hq_root__ 본사 1칸에 대응)
  if ((rankCounts['본사'] ?? 0) > 0) rankCounts['본사'] = 1;
  else if (tree.length > 0) rankCounts['본사'] = 1;

  const statusLabel: Record<string, string> = {
    completed: '완료',
    failed: '실패',
    running: '진행 중',
  };

  const [basisYear, basisMonth] = label_year_month.split('-');
  const rankDisplayOrder = ['본사', '사업본부장', '센터장', '리더', '영업사원'];
  const rankSummaryParts = [...rankDisplayOrder, ...Object.keys(rankCounts).filter((r) => !rankDisplayOrder.includes(r))]
    .filter((r) => (rankCounts[r] ?? 0) > 0)
    .map((r) => `${r} ${rankCounts[r]}`);

  return (
    <div className="p-3 sm:p-6">
      {/* Hero: 제목·기준 기간·핵심 수치 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4">
        <div className="border-b border-orange-100/80 bg-gradient-to-r from-orange-50/90 via-white to-slate-50/90 px-3 py-3 sm:px-4 sm:py-3.5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700/85">관리자</p>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">조직도</h1>
              <p className="mt-1 text-[11px] leading-snug text-slate-600 sm:text-xs">
                <span className="font-medium text-orange-900/90">{basisYear}년</span>{' '}
                <span className="font-medium text-orange-900/90">{basisMonth}월</span>
                <span className="text-slate-400"> · </span>
                <span className="tabular-nums text-slate-500">
                  {start_date} ~ {end_date}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 gap-4 sm:gap-6">
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums leading-none text-slate-900 sm:text-3xl">
                  {orgTreeVisibleCountExcludingHqRank.toLocaleString('ko-KR')}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-500 sm:text-[11px]">전체 인원</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold tabular-nums leading-none text-orange-600 sm:text-3xl">
                  {contractCount.toLocaleString('ko-KR')}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-500 sm:text-[11px]">계약 수</p>
              </div>
            </div>
          </div>
        </div>

        {/* 동기화: 보조 버튼 + 한 줄 상태 */}
        <div className="flex flex-col gap-2 border-b border-slate-100/90 bg-slate-50/50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4">
          <SyncButton />
          {lastSync ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-600 sm:justify-end">
              <span className="truncate text-slate-700">
                최근 동기화
                <span className="text-slate-400"> · </span>
                {formatSyncBarTime(lastSync.finished_at ?? lastSync.started_at)}
                {lastSync.status !== 'completed' && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="font-medium text-amber-800">
                      {statusLabel[lastSync.status] ?? lastSync.status}
                    </span>
                  </>
                )}
                {lastSync.total_updated != null && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="tabular-nums">{lastSync.total_updated.toLocaleString('ko-KR')}건 갱신</span>
                  </>
                )}
                {lastSync.total_fetched != null && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="tabular-nums">조회 {lastSync.total_fetched.toLocaleString('ko-KR')}</span>
                  </>
                )}
                {(lastSync.total_errors ?? 0) > 0 && (
                  <>
                    <span className="text-slate-400"> · </span>
                    <span className="font-medium text-red-600">오류 {lastSync.total_errors}</span>
                  </>
                )}
              </span>
              {lastSync.status === 'completed' && (
                <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                  완료
                </span>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-amber-800 sm:text-right">동기화 기록이 없습니다. TY Life 동기화를 실행해 주세요.</p>
          )}
        </div>
      </section>

      {/* 기준월 선택: /organization 과 유사한 카드 + 컴팩트 툴바 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-2.5 flex flex-col gap-0.5 border-b border-slate-100 pb-2.5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[13px] font-semibold tabular-nums text-slate-800 sm:text-sm">
            <span className="text-orange-800">{basisYear}년</span> <span className="text-orange-800">{basisMonth}월</span>{' '}
            기준
          </p>
          <p className="text-[10px] text-slate-500 sm:text-xs">월별 정산 구간에 맞춰 지표를 불러옵니다.</p>
        </div>
        <YearMonthSelector
          layout="compact-toolbar"
          className="min-w-0"
          value={label_year_month}
          todayValue={defaultYearMonth}
          years={yearsForPicker}
          todayLabel="오늘 기준월"
        />
      </section>

      {/* 직급 구성 + 실적: 한 카드 안에서 모바일 압축 */}
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-orange-100/90 bg-orange-50/40 px-2.5 py-2 text-[11px] text-slate-800 sm:text-xs">
          <span className="font-semibold text-orange-900/90">구성</span>
          <span className="text-slate-400">|</span>
          <span className="tabular-nums text-slate-700">
            {rankSummaryParts.length > 0 ? rankSummaryParts.join(' · ') : '—'}
          </span>
        </div>

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-orange-800/90">실적</p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
          <div
            className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5"
            title={`기준 ${label_year_month} (${start_date}~${end_date})`}
          >
            <p className="text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">이번달 준비</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
              {periodPendingUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div
            className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5"
            title={`기준 ${label_year_month} (${start_date}~${end_date})`}
          >
            <p className="text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">이번달 가입</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
              {periodJoinUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5">
            <p className="text-[10px] font-medium leading-tight text-slate-500 sm:text-[11px]">누적 가입</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:text-xl">
              {totalJoinUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div
            className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-orange-50/30 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-orange-100/60 sm:px-2.5 sm:py-2.5"
            title={formatWon(totalSales)}
          >
            <p className="text-[10px] font-medium leading-tight text-orange-900/80 sm:text-[11px]">총 매출</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:hidden">
              {formatWonShort(totalSales)}
            </p>
            <p className="mt-1 hidden text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:block sm:text-xl">
              {formatWon(totalSales)}
            </p>
          </div>
          <div
            className="col-span-2 flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-orange-50/25 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-orange-100/50 sm:col-span-1 sm:px-2.5 sm:py-2.5"
            title={`${formatWon(periodSales)} · ${label_year_month}`}
          >
            <p className="text-[10px] font-medium leading-tight text-orange-900/80 sm:text-[11px]">이번달 매출</p>
            <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:hidden">
              {formatWonShort(periodSales)}
            </p>
            <p className="mt-1 hidden text-lg font-semibold tabular-nums tracking-tight text-orange-950 sm:block sm:text-xl">
              {formatWon(periodSales)}
            </p>
          </div>
        </div>
      </section>

      {/* 조직 트리 */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-4">
        {members.length > 0 && tree.length === 0 && (
          <p className="text-xs text-amber-600 mb-4 text-center">
            {members.length}명이 있지만 조직 계층 연결(edges)이 없습니다. 상하위 관계를 등록하면 트리로 표시됩니다.
          </p>
        )}
        <OrgTree
          roots={tree}
          contractsByMember={contractsByMember}
          metricsById={orgMetricsById}
          goalUnitsByMemberId={(() => {
            const out: Record<string, number> = {};
            for (const m of members as Array<{ id: string; monthly_target_units?: number | null }>) {
              const v = (m as any).monthly_target_units;
              if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[m.id] = v;
            }
            return out;
          })()}
          showGoalUnitsLine={true}
          showGoalProgressBar={true}
          showCommissionMetrics={false}
        />
      </div>

      {/* 조직도 기준 정산 담당자 자동 보정 패널은 현재 UI 에서는 숨김 처리.
          관련 API(/api/admin/contracts/settlement-sales-member/*) 와 컴포넌트는 보존된다. */}
      {/* <SettlementSalesMemberOverridePanel /> */}
    </div>
  );
}
