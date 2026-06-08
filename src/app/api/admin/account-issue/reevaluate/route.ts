import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { runPreIssuedAccountAutoMapping } from '@/lib/account-issue/auto-mapping';

/**
 * 사전 발급 계정 전체에 대해 자동 매핑을 즉시 재평가한다.
 * - 동기화를 기다리지 않고 관리자가 화면에서 트리거할 수 있도록 별도 라우트로 분리.
 * - dryRun 쿼리 파라미터로 미리보기도 가능.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
  const db = createAdminSupabaseClient();
  try {
    const result = await runPreIssuedAccountAutoMapping(db, { dryRun });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
