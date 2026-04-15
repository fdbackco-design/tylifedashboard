/**
 * 계약자 이름(contractor_name) → organization_members 매칭.
 * 0건 → missing, 2건 이상 → ambiguous, 1건 → single.
 *
 * NOTE:
 * - “내부 영업사원 편입” 자동화는 오탐 리스크가 커서,
 *   ambiguous는 반드시 관리자 매핑(pending)으로 분리한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ContractorResolveResult =
  | { kind: 'single'; memberId: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; ids: string[] };

export async function resolveContractorByNameOnly(
  db: SupabaseClient,
  rawName: string | null | undefined,
): Promise<ContractorResolveResult> {
  const name = rawName?.trim() ?? '';
  if (!name) return { kind: 'missing' };

  const { data, error } = await db
    .from('organization_members')
    .select('id')
    .eq('name', name)
    .eq('is_active', true);

  if (error) throw new Error(`계약자 이름 조회 실패: ${error.message}`);

  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return { kind: 'missing' };
  if (rows.length === 1) return { kind: 'single', memberId: rows[0].id };
  return { kind: 'ambiguous', ids: rows.map((r) => r.id) };
}

