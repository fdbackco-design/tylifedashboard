/**
 * POST /api/sync — 수동 동기화 실행
 * GET  /api/sync — 최근 sync_runs 조회
 *
 * Authorization: Bearer {SYNC_API_SECRET} 헤더 필수.
 *
 * POST body:
 *   mode?        : 'auto' | 'manual'
 *   rowPerPage?  : number  (기본 50)
 *   maxPage?     : number  (미설정 시 전체)
 *   dryRun?      : boolean (기본 false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSync, syncContractPage } from '@/lib/tylife/sync-service';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { notifyAdminsOfNewContracts } from '@/lib/push/admin-event-notify';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.SYNC_API_SECRET;

  if (!secret) {
    console.error('[api/sync] SYNC_API_SECRET 환경변수 미설정');
    return false;
  }

  return verifyBearerMatchesEnvSecret(req, secret);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    mode?: string;
    rowPerPage?: number;
    maxPage?: number;
    dryRun?: boolean;
    /** 단일 페이지만 동기화 (테스트용) */
    page?: number;
  } = {};

  try {
    body = await req.json();
  } catch {
    // body 없는 경우 기본값 사용
  }

  const triggeredBy = body.mode === 'auto' ? 'cron' : 'manual';

  try {
    // page 지정 시 단일 페이지만 동기화
    if (body.page != null) {
      const result = await syncContractPage(
        body.page,
        { rowPerPage: body.rowPerPage, dryRun: body.dryRun },
      );
      return NextResponse.json({ success: true, result });
    }

    const result = await runSync({
      triggeredBy,
      rowPerPage: body.rowPerPage,
      maxPage: body.maxPage,
      dryRun: body.dryRun,
    });

    // 신규 계약이 1건 이상 생성된 경우 관리자에게 푸시 알림 발송 (수동/cron 공통 후처리).
    // dryRun 인 경우엔 실제 DB insert 가 없으므로 알림 발송도 생략.
    let adminNotify: Awaited<ReturnType<typeof notifyAdminsOfNewContracts>> | null = null;
    if (!body.dryRun && result?.run_id && (result.total_created ?? 0) > 0) {
      try {
        const db = createAdminSupabaseClient();
        adminNotify = await notifyAdminsOfNewContracts(db, result.run_id);
      } catch (e) {
        console.error('[api/sync] admin notify failed', e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({ success: true, result, adminNotify });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sync] 동기화 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  const { data, error } = await db
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
