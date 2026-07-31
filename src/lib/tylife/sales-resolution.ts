/**
 * 담당자 이름만으로 DB 매칭 (동기화 리스트 단계).
 * 0건 → 미매칭, 2건 이상 → 동명이인(대기), 1건 → 확정.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type NameResolveResult =
  | { kind: 'single'; memberId: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; ids: string[] };

type SalesNameCandidateRow = {
  id: string;
  external_id: string | null;
  source_customer_id: string | null;
};

/**
 * `customer:*`는 계약 고객을 조직도에 표시하기 위한 가상 노드다.
 * 담당자 원본에는 이름만 오는 경우가 많아 이 노드를 후보로 섞으면 동명이인 고객이
 * 실제 영업자로 오인된다. `cust:*`는 과거 계정 발급으로 직원 전환된 노드이므로 허용한다.
 */
export function isSalesNameCandidate(row: SalesNameCandidateRow): boolean {
  return !String(row.external_id ?? '').startsWith('customer:');
}

export async function resolveSalesMemberByNameOnly(
  db: SupabaseClient,
  rawName: string | null | undefined,
): Promise<NameResolveResult> {
  const name = rawName?.trim() ?? '';
  if (!name) return { kind: 'missing' };

  const { data, error } = await db
    .from('organization_members')
    .select('id, external_id, source_customer_id')
    .eq('name', name)
    .eq('is_active', true);

  if (error) throw new Error(`담당자 이름 조회 실패: ${error.message}`);

  const rows = ((data ?? []) as SalesNameCandidateRow[]).filter(isSalesNameCandidate);
  if (rows.length === 0) return { kind: 'missing' };
  if (rows.length === 1) return { kind: 'single', memberId: rows[0].id };
  return { kind: 'ambiguous', ids: rows.map((r) => r.id) };
}
