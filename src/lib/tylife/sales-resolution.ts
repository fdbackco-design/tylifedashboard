/**
 * 담당자 이름만으로 DB 매칭 (동기화 리스트 단계).
 * 0건 → 미매칭, 2건 이상 → 동명이인(대기), 1건 → 확정.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { findAccountBackedCustomerMemberIds } from './self-contract-sales';

export type NameResolveResult =
  | { kind: 'single'; memberId: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; ids: string[] };

type SalesNameCandidateRow = {
  id: string;
  name: string | null;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
};

/**
 * `customer:*`는 계약 고객을 조직도에 표시하기 위한 가상 노드다.
 * 담당자 원본에는 이름만 오는 경우가 많아 이 노드를 후보로 섞으면 동명이인 고객이
 * 실제 영업자로 오인된다. 다만 활성 계정의 이름·전화번호가 노드와 일치하면 실제 영업자이므로 허용한다.
 * `cust:*`는 과거 계정 발급으로 직원 전환된 노드이므로 그대로 허용한다.
 */
export function isSalesNameCandidate(
  row: SalesNameCandidateRow,
  accountBackedCustomerMemberIds: ReadonlySet<string> = new Set(),
): boolean {
  return (
    !String(row.external_id ?? '').startsWith('customer:') ||
    accountBackedCustomerMemberIds.has(row.id)
  );
}

export async function resolveSalesMemberByNameOnly(
  db: SupabaseClient,
  rawName: string | null | undefined,
): Promise<NameResolveResult> {
  const name = rawName?.trim() ?? '';
  if (!name) return { kind: 'missing' };

  const { data, error } = await db
    .from('organization_members')
    .select('id, name, phone, external_id, source_customer_id')
    .eq('name', name)
    .eq('is_active', true);

  if (error) throw new Error(`담당자 이름 조회 실패: ${error.message}`);

  const allRows = (data ?? []) as SalesNameCandidateRow[];
  const customerRows = allRows.filter((row) =>
    String(row.external_id ?? '').startsWith('customer:'),
  );
  const accountBackedCustomerMemberIds = await findAccountBackedCustomerMemberIds(
    db,
    customerRows,
  );
  const rows = allRows.filter((row) =>
    isSalesNameCandidate(row, accountBackedCustomerMemberIds),
  );
  if (rows.length === 0) return { kind: 'missing' };
  if (rows.length === 1) return { kind: 'single', memberId: rows[0].id };
  return { kind: 'ambiguous', ids: rows.map((r) => r.id) };
}
