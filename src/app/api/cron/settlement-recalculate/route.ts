/**
 * GET /api/cron/settlement-recalculate
 *
 * `/admin/settlement` 의 "정산 재계산" 버튼이 호출하는 것과 동일한 재계산
 * 로직(`calculateMonthlySettlement`)을 서버에서 직접 호출한다.
 *
 * 자동으로 처리하는 정산월:
 * - 오늘(서울) 기준 이번 정산월
 * - 그 한 달 전 정산월
 *
 * 예: 오늘(서울 시각)이 2026-06-... 이면 `2026-06`, `2026-05` 두 월을 재계산.
 *
 * 인증: `Authorization: Bearer …` 가 다음과 일치해야 한다.
 * - `CRON_SECRET`이 있으면 그 값 (Vercel Cron이 자동으로 이 헤더를 붙일 때 사용)
 * - 없으면 `SYNC_API_SECRET`
 *
 * 안전장치:
 * - `monthly_settlements.is_finalized = true` 인 월은 자동 재계산을 건너뛴다.
 *   (수동 버튼과 동일한 정책: `/api/settlement/calculate` 의 force=false 동작과 동일)
 *
 * 스케줄: 매일 한국시간 10:10 → UTC 01:10 (`10 1 * * *`)
 *  - `tylife-sync` (KST 10:00) 완료 직후에 동작해 그 날 동기화된 신규 계약까지 반영되도록 살짝 늦춰둠.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyBearerMatchesEnvSecret } from '@/lib/api/verify-bearer-env-secret';
import { calculateMonthlySettlement } from '@/lib/settlement/monthly-calculate';
import { getSettlementWindowSeoul } from '@/lib/settlement/settlement-window';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
/** 두 개월 연속 재계산이 길어질 수 있으므로 sync 와 동일한 상한을 사용한다. */
export const maxDuration = 300;

function addMonthsToLabel(label: string, delta: number): string {
  const [ys, ms] = label.split('-');
  const y = parseInt(ys, 10);
  const m = parseInt(ms, 10);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

type Outcome =
  | { year_month: string; status: 'recalculated'; updated_count: number }
  | { year_month: string; status: 'skipped_finalized' }
  | { year_month: string; status: 'failed'; error: string };

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

  const db = createAdminSupabaseClient();
  const currentLabel = getSettlementWindowSeoul().label_year_month;
  const previousLabel = addMonthsToLabel(currentLabel, -1);
  const targets = [currentLabel, previousLabel];

  // eslint-disable-next-line no-console
  console.log('[api/cron/settlement-recalculate] invoked', {
    targets,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_REGION: process.env.VERCEL_REGION ?? null,
  });

  const outcomes: Outcome[] = [];

  for (const yearMonth of targets) {
    try {
      const { data: finalizedRows, error: finErr } = await db
        .from('monthly_settlements')
        .select('id')
        .eq('year_month', yearMonth)
        .eq('is_finalized', true)
        .limit(1);

      if (finErr) {
        console.error(
          `[api/cron/settlement-recalculate] ${yearMonth} finalized 조회 실패:`,
          finErr.message,
        );
        outcomes.push({ year_month: yearMonth, status: 'failed', error: finErr.message });
        continue;
      }

      if (finalizedRows && finalizedRows.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[api/cron/settlement-recalculate] ${yearMonth} 확정된 정산이라 재계산을 건너뜁니다.`,
        );
        outcomes.push({ year_month: yearMonth, status: 'skipped_finalized' });
        continue;
      }

      const result = await calculateMonthlySettlement({ yearMonth, db });
      // eslint-disable-next-line no-console
      console.log('[api/cron/settlement-recalculate] finished', {
        year_month: yearMonth,
        updated_count: result.updated_count,
      });
      outcomes.push({
        year_month: yearMonth,
        status: 'recalculated',
        updated_count: result.updated_count,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api/cron/settlement-recalculate] ${yearMonth} 실패:`, message);
      outcomes.push({ year_month: yearMonth, status: 'failed', error: message });
    }
  }

  const anyFailure = outcomes.some((o) => o.status === 'failed');
  return NextResponse.json(
    { success: !anyFailure, results: outcomes },
    { status: anyFailure ? 500 : 200 },
  );
}
