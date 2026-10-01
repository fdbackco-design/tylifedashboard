/**
 * 매일 16:00(Asia/Seoul) TY케어플랜 24개월 상태 전용 동기화.
 * 계약 목록만 조회하며 상세/고객/조직/승급/정산 후처리는 실행하지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';
import { runCarePlanStatusSync } from '@/lib/tylife/care-plan-status-sync';
import { getTyLifeCookie, hasTyLifeCredentials } from '@/lib/tylife/env';

export const dynamic = 'force-dynamic';
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
      { success: false, error: 'TY Life 세션 환경변수가 필요합니다.' },
      { status: 503 },
    );
  }

  try {
    const result = await runCarePlanStatusSync();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/cron/care-plan-status-sync]', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
