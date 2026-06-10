/**
 * GET /api/admin/organization-members/search?q=<이름 일부>&limit=20
 *
 * 정산 담당자 override 모달에서 새 담당자 후보를 검색하기 위한 API.
 * 활성 조직원(is_active=true)만 반환한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limitRaw = url.searchParams.get('limit');
  const limit = Math.min(
    50,
    Math.max(1, limitRaw ? Math.floor(Number(limitRaw)) || 20 : 20),
  );

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const db = createAdminSupabaseClient();
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const { data, error } = await db
    .from('organization_members')
    .select('id, name, rank, is_active, external_id, phone')
    .eq('is_active', true)
    .ilike('name', like)
    .order('name', { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = ((data ?? []) as any[]).map((m) => {
    const ext = (m.external_id ?? '') as string;
    // customer:* external_id 는 노이즈가 많으므로 라벨에는 노출하지 않는다.
    const extLabel = ext && !ext.startsWith('customer:') ? ext : '';
    return {
      id: m.id as string,
      name: m.name as string,
      rank: (m.rank ?? null) as string | null,
      external_id: (m.external_id ?? null) as string | null,
      phone: (m.phone ?? null) as string | null,
      label: `${m.name}${m.rank ? ` (${m.rank})` : ''}${extLabel ? ` · ${extLabel}` : ''}`,
    };
  });

  return NextResponse.json({ results });
}
