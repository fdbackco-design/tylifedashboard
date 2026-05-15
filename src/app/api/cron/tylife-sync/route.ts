/**
 * GET /api/cron/tylife-sync
 *
 * Vercel Cron 등에서 호출. 조직도「TY Life 동기화」와 동일한 파이프라인은
 * 서버 타임아웃을 피하기 위해 UI는 `/api/sync/run` 분할 호출을 쓰고,
 * 여기서는 한 번에 끝까지 도는 `runSync`를 사용한다(POST /api/sync 와 동일).
 *
 * 인증: `Authorization: Bearer …` 가 다음과 일치해야 한다.
 * - `CRON_SECRET`이 있으면 그 값 (Vercel Cron이 자동으로 이 헤더를 붙일 때 사용)
 * - 없으면 `SYNC_API_SECRET`
 *
 * 스케줄: 서울 매일 10:00 → UTC 01:00 (`0 1 * * *`, 한국은 서머타임 없음)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSync } from '@/lib/tylife/sync-service';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';

export const dynamic = 'force-dynamic';
/** Vercel Pro 등에서 긴 동기화 허용 (플랜별 상한은 Vercel 정책 따름) */
export const maxDuration = 300;

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

  if (!process.env.TYLIFE_COOKIE) {
    return NextResponse.json(
      { success: false, error: 'TYLIFE_COOKIE 환경변수가 설정되지 않았습니다.' },
      { status: 503 },
    );
  }

  const rowPerPage = parseInt(process.env.TYLIFE_SYNC_PAGE_SIZE ?? '50', 10);

  try {
    const result = await runSync({
      triggeredBy: 'cron-vercel-daily-10kst',
      rowPerPage: Number.isFinite(rowPerPage) && rowPerPage > 0 ? rowPerPage : 50,
    });
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/cron/tylife-sync]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
