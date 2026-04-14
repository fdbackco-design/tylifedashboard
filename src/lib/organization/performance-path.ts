/**
 * 조직 edges를 따라 담당자 → 루트까지 올라간 뒤,
 * 실적 스탬핑용으로 [루트 … 담당자] 순서의 배열을 만든다.
 */

import type { PostgrestSingleResponse, SupabaseClient } from '@supabase/supabase-js';
import type { RankType } from '@/lib/types/organization';

export interface PerformancePathSegment {
  id: string;
  name: string;
  rank: RankType;
}

/**
 * parent_id 체인을 따라 루트까지 수집한 뒤, 루트→리프(담당자) 순으로 반환.
 * 부모가 없으면 [담당자] 단일 요소.
 */
export async function buildPerformancePath(
  db: SupabaseClient,
  salesMemberId: string,
): Promise<PerformancePathSegment[]> {
  const bottomUp: PerformancePathSegment[] = [];
  let current: string | null = salesMemberId;

  for (let depth = 0; depth < 64; depth++) {
    if (!current) break;
    const atId: string = current;

    const { data: m, error: mErr } = await db
      .from('organization_members')
      .select('id, name, rank')
      .eq('id', atId)
      .maybeSingle();

    if (mErr) throw new Error(`organization_members 조회 실패: ${mErr.message}`);
    if (!m) break;

    bottomUp.push({
      id: (m as { id: string }).id,
      name: (m as { name: string }).name,
      rank: (m as { rank: RankType }).rank,
    });
    const edgeQuery: PostgrestSingleResponse<{ parent_id: string | null } | null> = await db
      .from('organization_edges')
      .select('parent_id')
      .eq('child_id', atId)
      .maybeSingle();

    if (edgeQuery.error) {
      throw new Error(`organization_edges 조회 실패: ${edgeQuery.error.message}`);
    }
    const parentId: string | null = edgeQuery.data?.parent_id ?? null;
    current = parentId;
  }

  bottomUp.reverse();
  return bottomUp;
}
