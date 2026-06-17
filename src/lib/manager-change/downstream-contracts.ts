/**
 * 영업자 산하 계약 목록 조회 (담당자 변경 신청용).
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrgContractSalesRemap } from '@/lib/organization/org-contract-sales-remap';
import {
  buildChildrenByParentFromRows,
  buildSettlementTreeRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';
import type { OrgTreeRow, RankType } from '@/lib/types';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';

export type DownstreamContractRow = {
  id: string;
  contract_code: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  resident_number: string;
  unit_count: number;
  item_name: string;
  status: string;
  current_manager_id: string | null;
  current_manager_name: string;
};

function stripCustomerPrefix(name: string | null | undefined): string {
  return (name ?? '').replace(/^\[고객\]\s*/, '').trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * 로그인 영업자 member_id 기준 산하(본인 포함) 계약 목록을 반환한다.
 */
export async function loadDownstreamContractsForMember(
  db: SupabaseClient,
  memberId: string,
): Promise<DownstreamContractRow[]> {
  const rootId = (memberId ?? '').trim();
  if (!rootId) return [];

  const [membersRes, edgesRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, phone, external_id, source_customer_id, is_active')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
  ]);
  if (membersRes.error) throw new Error(membersRes.error.message);
  if (edgesRes.error) throw new Error(edgesRes.error.message);

  const membersRaw = ((membersRes.data ?? []) as Array<{
    id: string;
    name: string;
    rank: RankType;
    phone: string | null;
    external_id: string | null;
    source_customer_id: string | null;
  }>).map((m) => (m.name === '안성준' ? { ...m, rank: '본사' as const } : m));

  const { remapMemberId, membersFiltered } = buildOrgContractSalesRemap(
    membersRaw as Parameters<typeof buildOrgContractSalesRemap>[0],
  );
  if (!membersFiltered.some((m) => m.id === rootId)) return [];

  const edgesRemapped = ((edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>).map(
    (e) => ({
      parent_id: e.parent_id ? remapMemberId(e.parent_id) : null,
      child_id: remapMemberId(e.child_id),
    }),
  );
  const memberIdSet = new Set(membersFiltered.map((m) => m.id));
  const treeRows = buildSettlementTreeRows(
    membersFiltered as Array<{ id: string; name: string; rank: RankType; source_customer_id?: string | null }>,
    edgesRemapped,
  );
  const edgeByChild = new Map<string, string | null>();
  for (const e of edgesRemapped) {
    if (!memberIdSet.has(e.child_id)) continue;
    edgeByChild.set(
      e.child_id,
      e.parent_id && memberIdSet.has(e.parent_id) ? e.parent_id : null,
    );
  }
  const treeRowsWithParent: OrgTreeRow[] = treeRows.map((r) => ({
    ...r,
    parent_id: r.rank === '본사' ? null : edgeByChild.get(r.id) ?? null,
  }));

  const childrenByParent = buildChildrenByParentFromRows(treeRowsWithParent);
  const subtreeIds = collectSubtreeMemberIdsDownstream(rootId, childrenByParent);
  const subtreeMemberIds = [...subtreeIds];
  if (subtreeMemberIds.length === 0) return [];

  const memberNameById = new Map(
    membersFiltered.map((m) => [m.id, stripCustomerPrefix(m.name) || m.name]),
  );

  const contractSelect =
    'id, contract_code, item_name, unit_count, status, rental_request_no, invoice_no, memo, sales_member_id, settlement_sales_member_id, customer_id, customers(name, phone, ssn_masked)';

  const contractChunks = chunk(subtreeMemberIds, 400);
  const contractResList = await Promise.all(
    contractChunks.map((ids) =>
      db
        .from('contracts')
        .select(contractSelect)
        .in('sales_member_id', ids)
        .order('join_date', { ascending: false })
        .limit(5000),
    ),
  );

  const rows: DownstreamContractRow[] = [];
  const seen = new Set<string>();

  for (const res of contractResList) {
    if (res.error) throw new Error(res.error.message);
    for (const raw of res.data ?? []) {
      const row = raw as unknown as {
        id: string;
        contract_code: string | null;
        item_name: string | null;
        unit_count: number | null;
        status: string | null;
        rental_request_no: string | null;
        invoice_no: string | null;
        memo: string | null;
        sales_member_id: string | null;
        settlement_sales_member_id: string | null;
        customer_id: string;
        customers: { name: string | null; phone: string | null; ssn_masked: string | null } | null;
      };
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);

      const managerId = remapMemberId(
        String(row.settlement_sales_member_id ?? row.sales_member_id ?? ''),
      ) || null;
      const customer = row.customers;
      rows.push({
        id: row.id,
        contract_code: String(row.contract_code ?? ''),
        customer_id: row.customer_id,
        customer_name: stripCustomerPrefix(customer?.name) || '-',
        customer_phone: customer?.phone ?? null,
        resident_number: String(customer?.ssn_masked ?? ''),
        unit_count: Math.max(1, Number(row.unit_count ?? 1) || 1),
        item_name: String(row.item_name ?? ''),
        status: getContractDisplayStatus({
          status: String(row.status ?? ''),
          rental_request_no: row.rental_request_no,
          invoice_no: row.invoice_no,
          memo: row.memo,
        }),
        current_manager_id: managerId,
        current_manager_name: managerId ? memberNameById.get(managerId) ?? '-' : '-',
      });
    }
  }

  rows.sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'ko-KR') || a.contract_code.localeCompare(b.contract_code));
  return rows;
}

/** 선택 계약과 동일 고객·동일 상품명 계약을 묶어 신청 payload 를 만든다. */
export function buildManagerChangeSelection(
  contracts: DownstreamContractRow[],
  selectedContractId: string,
): {
  contract_id: string;
  customer_id: string;
  customer_name: string;
  resident_number: string;
  customer_phone: string | null;
  account_count: number;
  contract_codes: string;
  item_name: string;
} | null {
  const selected = contracts.find((c) => c.id === selectedContractId);
  if (!selected) return null;

  const siblings = contracts.filter(
    (c) => c.customer_id === selected.customer_id && c.item_name === selected.item_name,
  );
  const codes = siblings.map((c) => c.contract_code).filter(Boolean);
  const account_count = siblings.reduce((sum, c) => sum + c.unit_count, 0);

  return {
    contract_id: selected.id,
    customer_id: selected.customer_id,
    customer_name: selected.customer_name,
    resident_number: selected.resident_number,
    customer_phone: selected.customer_phone,
    account_count,
    contract_codes: codes.join(' / '),
    item_name: selected.item_name,
  };
}

/** 계약이 member 산하에 속하는지 검증 */
export async function assertContractInMemberDownstream(
  db: SupabaseClient,
  memberId: string,
  contractId: string,
): Promise<boolean> {
  const contracts = await loadDownstreamContractsForMember(db, memberId);
  return contracts.some((c) => c.id === contractId);
}
