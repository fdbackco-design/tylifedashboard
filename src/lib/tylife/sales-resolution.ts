/**
 * 담당자 이름만으로 DB 매칭 (동기화 리스트 단계).
 * 0건 → 미매칭, 2건 이상 → 동명이인(대기), 1건 → 확정.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type NameResolveResult =
  | { kind: 'single'; memberId: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; ids: string[] };

export async function resolveSalesMemberByNameOnly(
  db: SupabaseClient,
  rawName: string | null | undefined,
): Promise<NameResolveResult> {
  const name = rawName?.trim() ?? '';
  if (!name) return { kind: 'missing' };

  const { data, error } = await db
    .from('organization_members')
    .select('id')
    .eq('name', name)
    .eq('is_active', true);

  if (error) throw new Error(`담당자 이름 조회 실패: ${error.message}`);

  const rows = (data ?? []) as { id: string }[];
  if (rows.length === 0) return { kind: 'missing' };
  if (rows.length === 1) return { kind: 'single', memberId: rows[0].id };
  return { kind: 'ambiguous', ids: rows.map((r) => r.id) };
}
