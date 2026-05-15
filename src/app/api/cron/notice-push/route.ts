/**
 * GET /api/cron/notice-push
 *
 * 예약 게시(시작일 도래) 공지 중 푸시 ON·미발송 건을 전체 구독자에게 발송.
 *
 * 인증: `Authorization: Bearer` — `CRON_SECRET` 또는 `SYNC_API_SECRET`
 *
 * 스케줄: 매일 한국시간 00:05 → UTC 15:05 (`5 15 * * *`)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';
import { processDueNoticePushes } from '@/lib/notices/push-notify';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET ?? process.env.SYNC_API_SECRET;
  if (!secret) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET 또는 SYNC_API_SECRET 환경변수가 필요합니다.' },
      { status: 503 },
    );
  }

  if (!verifyBearerMatchesEnvSecret(req, secret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = createAdminSupabaseClient();
    const result = await processDueNoticePushes(db);
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/cron/notice-push]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
