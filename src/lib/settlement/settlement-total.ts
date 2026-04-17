import type { RankType } from '@/lib/types';
import { buildOrgTree } from '@/lib/settlement/calculator';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { calculateOrgNodeMetrics } from '@/lib/settlement/org-node-metrics';
import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';

const ZERO_OUT_MEMBER_NAME = '정성은';

/**
 * 정산 현황(/settlement)과 동일한 기준으로 "정산 합계(수당)"를 계산한다.
 * - v_contract_settlement_base(가입 인정 기준) 기반
 * - customer_id -> 조직원 매핑 정책 동일
 * - org-node-metrics(실지급액) 합계
 * - 숨김 멤버/제로아웃 멤버 제외
 */
export async function calculateSettlementTotalAmountForYearMonth(db: any, yearMonth: string): Promise<number> {
  const [{ start_date, end_date }, membersRes, edgesRes, eligibleBaseRes, rulesRes] = await Promise.all([
    Promise.resolve(getSettlementWindowForYearMonth(yearMonth)),
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('v_contract_settlement_base')
      .select('contract_id, contract_code, join_date, unit_count, status, is_cancelled, sales_member_id')
      .eq('year_month', yearMonth),
    db.from('settlement_rules').select('*'),
  ]);

  const membersRaw = (((membersRes.data ?? []) as unknown as any[]) ?? []).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

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

  const treeRows = membersRaw.map((m) => ({
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
  const roots = buildOrgTree(treeRows as any[]);

  const baseRows = (eligibleBaseRes.data ?? []) as Array<{
    contract_id: string;
    contract_code: string;
    join_date: string | null;
    unit_count: number | null;
    status: string;
    is_cancelled: boolean;
    sales_member_id: string;
  }>;

  const contractIds = baseRows.map((r) => r.contract_id);
  const { data: contractCustomerRows } = await db
    .from('contracts')
    .select('id, customer_id, item_name')
    .in('id', contractIds);

  const customerIdByContractId = new Map<string, string>();
  const itemNameByContractId = new Map<string, string | null>();
  for (const r of (contractCustomerRows ?? []) as Array<{ id: string; customer_id: string; item_name?: string | null }>) {
    customerIdByContractId.set(r.id, r.customer_id);
    itemNameByContractId.set(r.id, (r as any).item_name ?? null);
  }

  // customer_id -> member_id (source_customer_id 우선, 없으면 external_id=customer:* 사용)
  const memberIdByCustomerId = new Map<string, string>();
  for (const m of membersRaw as any[]) {
    const sid = (m.source_customer_id ?? null) as string | null;
    if (sid) {
      memberIdByCustomerId.set(sid, m.id as string);
      continue;
    }
    const ext = (m.external_id ?? null) as string | null;
    if (ext && ext.startsWith('customer:')) {
      memberIdByCustomerId.set(ext.slice('customer:'.length), m.id as string);
    }
  }

  const eligibleContracts = baseRows.map((r) => {
    const customer_id = customerIdByContractId.get(r.contract_id) ?? null;
    const item_name = itemNameByContractId.get(r.contract_id) ?? null;
    let sales_member_id = r.sales_member_id;
    if (customer_id) {
      const mapped = memberIdByCustomerId.get(customer_id);
      if (mapped) {
        sales_member_id = mapped;
      } else if (hqIdsRaw.has(r.sales_member_id)) {
        // fallback (HQ only): customer 매핑이 존재할 때만 치환 가능하므로 여기선 그대로 둔다
      }
    }
    return { ...r, id: r.contract_id, customer_id, sales_member_id, unit_count: r.unit_count ?? 0, item_name };
  });

  const orgMetricsById = calculateOrgNodeMetrics({
    roots,
    members: membersRaw.map((m) => ({ id: m.id as string, rank: m.rank as RankType })),
    edges: edgesRaw,
    contracts: eligibleContracts as any[],
    rules: (rulesRes.data ?? []) as any[],
    settlementWindow: { start_date, end_date, label_year_month: yearMonth },
  });

  const isHiddenByName = (rawName: string): boolean => {
    if (rawName.replace(/^\[고객\]\s*/, '').trim() === '안성준') return true;
    return isOrgDisplayHiddenMemberName(rawName);
  };

  let total = 0;
  for (const m of membersRaw as any[]) {
    const rawName = String(m.name ?? '');
    if (rawName === ZERO_OUT_MEMBER_NAME) continue;
    if (isHiddenByName(rawName)) continue;
    total += orgMetricsById[m.id as string]?.paidCommissionWon ?? 0;
  }

  return total;
}

