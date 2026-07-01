import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { probeTyLifeSession } from '@/lib/tylife/client';

export const dynamic = 'force-dynamic';

/** GET /api/admin/tylife-session-check — TY Life 세션·환경변수 진단 (관리자 전용) */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const probe = await probeTyLifeSession();
    return NextResponse.json({ success: probe.ok, probe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
