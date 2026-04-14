/**
 * POST /api/sync/run
 * 관리자 UI에서 직접 호출하는 내부 동기화 엔드포인트.
 * Bearer 토큰 불필요 — TYLIFE_COOKIE 설정 여부로 실행 가능 여부 판단.
 *
 * body: { maxPage?: number, dryRun?: boolean }
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSync } from '@/lib/tylife/sync-service';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // TYLIFE_COOKIE 미설정이면 실행 불가
  if (!process.env.TYLIFE_COOKIE) {
    return NextResponse.json(
      {
        success: false,
        error: 'TYLIFE_COOKIE 환경변수가 설정되지 않았습니다. Vercel 환경변수를 확인하세요.',
      },
      { status: 503 },
    );
  }

  let body: { maxPage?: number; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body 없으면 기본값 사용
  }

  console.log('[sync/run] 동기화 시작', {
    maxPage: body.maxPage ?? 'unlimited',
    dryRun: body.dryRun ?? false,
  });

  try {
    const result = await runSync({
      triggeredBy: 'ui',
      maxPage: body.maxPage,
      dryRun: body.dryRun ?? false,
    });

    console.log('[sync/run] 동기화 완료', result);

    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync/run] 동기화 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
