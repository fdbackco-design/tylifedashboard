/**
 * GET /api/organization
 * 조직 트리 조회.
 * ?root_id=UUID: 특정 멤버 하위 트리. 미지정 시 전체 트리.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildOrgTree } from '@/lib/settlement/calculator';
import type { OrgTreeRow } from '@/lib/types';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rootId = req.nextUrl.searchParams.get('root_id');
  const db = createAdminSupabaseClient();

  let rows: OrgTreeRow[];

  if (rootId) {
    // DB 함수로 특정 루트의 하위 트리 조회
    const { data, error } = await db.rpc('get_org_tree', {
      p_root_id: rootId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    rows = (data as OrgTreeRow[]) ?? [];
  } else {
    // 전체 조직원 + edges 조회 후 트리 빌드
    const [membersRes, edgesRes] = await Promise.all([
      db
        .from('organization_members')
        .select('id, name, rank')
        .eq('is_active', true)
        .order('name'),
      db.from('organization_edges').select('parent_id, child_id'),
    ]);

    if (membersRes.error) {
      return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
    }

    // flat 구조 → OrgTreeRow 변환
    const edgeMap = new Map<string, string | null>();
    for (const edge of edgesRes.data ?? []) {
      edgeMap.set(
        (edge as { child_id: string; parent_id: string | null }).child_id,
        (edge as { child_id: string; parent_id: string | null }).parent_id,
      );
    }

    rows = (membersRes.data ?? []).map((m, idx) => ({
      id: (m as { id: string }).id,
      name: (m as { name: string }).name,
      rank: (m as { rank: string }).rank as OrgTreeRow['rank'],
      parent_id: edgeMap.get((m as { id: string }).id) ?? null,
      depth: 0, // buildOrgTree가 재귀로 처리
    }));
  }

  const tree = buildOrgTree(rows);
  return NextResponse.json({ data: tree });
}
