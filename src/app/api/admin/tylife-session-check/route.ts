import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { probeTyLifeSession } from '@/lib/tylife/client';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';

export const dynamic = 'force-dynamic';

/** GET /api/admin/tylife-session-check — TY Life 세션·환경변수 진단 (관리자 전용) */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const adminOk = await isAdminAuthed(req);
  const secret = process.env.SYNC_API_SECRET ?? null;
  const bearerOk = secret ? verifyBearerMatchesEnvSecret(req, secret) : false;
  if (!adminOk && !bearerOk) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  try {
    const probe = await probeTyLifeSession();
    return NextResponse.json({ success: probe.ok, probe });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
