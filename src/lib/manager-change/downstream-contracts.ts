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
  join_date: string;
  unit_count: number;
  item_name: string;
  status: string;
  current_manager_id: string | null;
  current_manager_name: string;
};

export type DownstreamContractGroup = {
  group_key: string;
  contract_ids: string[];
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  resident_number: string;
  join_date: string;
  item_name: string;
  contract_codes: string;
  account_count: number;
  current_manager_id: string | null;
  current_manager_name: string;
  statuses: string[];
};

function phoneDigitsOnly(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '');
}

/** 고객·연락처·가입일·담당자·상품명이 동일한 계약 묶음 키 */
export function buildContractGroupKey(
  c: Pick<
    DownstreamContractRow,
    'customer_id' | 'customer_phone' | 'join_date' | 'current_manager_id' | 'item_name'
  >,
): string {
  return [
    c.customer_id,
    phoneDigitsOnly(c.customer_phone),
    c.join_date,
    c.current_manager_id ?? '',
    c.item_name,
  ].join('|');
}

export function groupDownstreamContracts(contracts: DownstreamContractRow[]): DownstreamContractGroup[] {
  const map = new Map<string, DownstreamContractRow[]>();
  for (const c of contracts) {
    const key = buildContractGroupKey(c);
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }

  const groups: DownstreamContractGroup[] = [];
  for (const [group_key, rows] of map) {
    const first = rows[0];
    const codes = [...rows].map((r) => r.contract_code).filter(Boolean).sort();
    const statuses = [...new Set(rows.map((r) => r.status))];
    groups.push({
      group_key,
      contract_ids: rows.map((r) => r.id),
      customer_id: first.customer_id,
      customer_name: first.customer_name,
      customer_phone: first.customer_phone,
      resident_number: first.resident_number,
      join_date: first.join_date,
      item_name: first.item_name,
      contract_codes: codes.join(' / '),
      account_count: rows.reduce((sum, r) => sum + r.unit_count, 0),
      current_manager_id: first.current_manager_id,
      current_manager_name: first.current_manager_name,
      statuses,
    });
  }

  groups.sort(
    (a, b) =>
      a.customer_name.localeCompare(b.customer_name, 'ko-KR') ||
      b.join_date.localeCompare(a.join_date) ||
      a.contract_codes.localeCompare(b.contract_codes),
  );
  return groups;
}

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
    'id, contract_code, join_date, item_name, unit_count, status, rental_request_no, invoice_no, memo, sales_member_id, settlement_sales_member_id, customer_id, customers(name, phone, ssn_masked)';

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
        join_date: string | null;
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
        join_date: String(row.join_date ?? '').slice(0, 10),
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

/** contract_ids 로 그룹 신청 payload 생성 (모두 동일 그룹이어야 함). */
export function buildManagerChangeSelectionFromContractIds(
  contracts: DownstreamContractRow[],
  contractIds: string[],
): {
  contract_id: string;
  contract_ids: string[];
  selection_group_key: string;
  customer_id: string;
  customer_name: string;
  resident_number: string;
  customer_phone: string | null;
  join_date: string;
  account_count: number;
  contract_codes: string;
  item_name: string;
} | null {
  const ids = [...new Set(contractIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return null;

  const selected = contracts.filter((c) => ids.includes(c.id));
  if (selected.length !== ids.length) return null;

  const groupKey = buildContractGroupKey(selected[0]);
  if (!selected.every((c) => buildContractGroupKey(c) === groupKey)) return null;

  const codes = [...selected].map((c) => c.contract_code).filter(Boolean).sort();
  const first = selected[0];
  return {
    contract_id: first.id,
    contract_ids: ids,
    selection_group_key: groupKey,
    customer_id: first.customer_id,
    customer_name: first.customer_name,
    resident_number: first.resident_number,
    customer_phone: first.customer_phone,
    join_date: first.join_date,
    account_count: selected.reduce((sum, c) => sum + c.unit_count, 0),
    contract_codes: codes.join(' / '),
    item_name: first.item_name,
  };
}

/** @deprecated 단일 id — 내부적으로 그룹 전체를 포함 */
export function buildManagerChangeSelection(
  contracts: DownstreamContractRow[],
  selectedContractId: string,
) {
  const selected = contracts.find((c) => c.id === selectedContractId);
  if (!selected) return null;
  const groupKey = buildContractGroupKey(selected);
  const siblings = contracts.filter((c) => buildContractGroupKey(c) === groupKey);
  return buildManagerChangeSelectionFromContractIds(
    contracts,
    siblings.map((c) => c.id),
  );
}

/** 계약 id 목록이 member 산하에 모두 속하는지 검증 */
export async function assertContractsInMemberDownstream(
  db: SupabaseClient,
  memberId: string,
  contractIds: string[],
): Promise<boolean> {
  const contracts = await loadDownstreamContractsForMember(db, memberId);
  const idSet = new Set(contracts.map((c) => c.id));
  return contractIds.every((id) => idSet.has(id));
}

/** @deprecated 단일 id */
export async function assertContractInMemberDownstream(
  db: SupabaseClient,
  memberId: string,
  contractId: string,
): Promise<boolean> {
  return assertContractsInMemberDownstream(db, memberId, [contractId]);
}
