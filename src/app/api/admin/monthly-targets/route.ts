/**
 * GET /api/admin/monthly-targets
 *
 * 모든 활성 조직원의 monthly_target_units 를 반환. (NULL 인 멤버도 포함하여 그대로 응답)
 * 관리자 페이지 트리에서 클라이언트가 표시·달성률 계산에 사용.
 *
 * 응답
 *   { targets: Array<{ id: string; monthly_target_units: number | null }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from('organization_members')
    .select('id, monthly_target_units')
    .eq('is_active', true);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    targets: ((data ?? []) as any[]).map((m) => ({
      id: m.id as string,
      monthly_target_units: (m.monthly_target_units ?? null) as number | null,
    })),
  });
}
