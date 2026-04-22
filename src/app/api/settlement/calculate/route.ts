/**
 * POST /api/settlement/calculate
 * 월별 정산 계산/재계산 (서버 전용)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { calculateMonthlySettlement } from '@/lib/settlement/monthly-calculate';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // TODO: 인증 추가 필요 (현재 서버 내부 호출 가정)
  let body: { year_month?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const { year_month, force = false } = body;

  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json(
      { error: 'year_month 필드가 필요합니다 (형식: YYYY-MM)' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();

  // 확정된 정산 재계산 방지
  if (!force) {
    const { data: existing } = await db
      .from('monthly_settlements')
      .select('id, is_finalized')
      .eq('year_month', year_month)
      .eq('is_finalized', true)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `${year_month} 정산이 이미 확정되었습니다. force=true로 재계산하세요.` },
        { status: 409 },
      );
    }
  }

  try {
    const result = await calculateMonthlySettlement({ yearMonth: year_month, db });
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/settlement/calculate] 정산 계산 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
