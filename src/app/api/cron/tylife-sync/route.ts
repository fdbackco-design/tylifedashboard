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
 * 스케줄: 10분마다 실행 (cron: `[asterisk]/10 [asterisk] [asterisk] [asterisk] [asterisk]`).
 *         실제 cron 식은 vercel.json 참조. 운영 환경의 TY Life 변경을 빠르게 감지하기 위함.
 *
 * 동기화 종료 후, 신규 계약이 1건 이상이면 관리자(role='admin') 다수에게 푸시 알림을 발송한다.
 * 알림 실패는 동기화 결과에 영향을 주지 않는다 (sync_runs.admin_notified_at 으로 중복 발송 방지).
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSync } from '@/lib/tylife/sync-service';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { notifyAdminsOfNewContracts } from '@/lib/push/admin-event-notify';
import { getTyLifeCookie, hasTyLifeCredentials } from '@/lib/tylife/env';

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

  if (!getTyLifeCookie() && !hasTyLifeCredentials()) {
    return NextResponse.json(
      {
        success: false,
        error:
          'TYLIFE_COOKIE(또는 TYLIFE_SESSION_COOKIE), 혹은 TYLIFE_ID/TYLIFE_PW 환경변수가 필요합니다.',
      },
      { status: 503 },
    );
  }

  const rowPerPage = parseInt(process.env.TYLIFE_SYNC_PAGE_SIZE ?? '50', 10);

  try {
    const result = await runSync({
      triggeredBy: 'cron-vercel-10min',
      rowPerPage: Number.isFinite(rowPerPage) && rowPerPage > 0 ? rowPerPage : 50,
    });

    // 신규 계약 1건 이상이면 관리자 다수에게 푸시 알림 발송.
    // 실패해도 동기화 결과는 그대로 반환한다 (sync_runs.admin_notified_at 으로 중복 방지).
    let adminNotify: Awaited<ReturnType<typeof notifyAdminsOfNewContracts>> | null = null;
    if (result?.run_id && (result.total_created ?? 0) > 0) {
      try {
        const db = createAdminSupabaseClient();
        adminNotify = await notifyAdminsOfNewContracts(db, result.run_id);
      } catch (e) {
        console.error('[api/cron/tylife-sync] admin notify failed', e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({ success: true, result, adminNotify });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/cron/tylife-sync]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
