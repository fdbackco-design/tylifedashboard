/**
 * GET  /api/settlement?year_month=YYYY-MM[&member_id=UUID]
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

// Route Handler 캐시 (URL 단위) — 월별 정산 조회는 자주 변하지 않음
export const revalidate = 30;

// ─────────────────────────────────────────────
// GET: 정산 결과 조회
// ─────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const yearMonth = searchParams.get('year_month');
  const memberId = searchParams.get('member_id');
  const rank = searchParams.get('rank');
  const includeDetail = searchParams.get('include_detail') === 'true';

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: 'year_month 파라미터가 필요합니다 (형식: YYYY-MM)' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();

  let query = db
    .from('monthly_settlements')
    .select(
      `
      id,
      year_month,
      member_id,
      rank,
      direct_contract_count,
      direct_unit_count,
      subordinate_unit_count,
      total_unit_count,
      base_commission,
      rollup_commission,
      incentive_amount,
      total_amount,
      is_finalized,
      ${includeDetail ? 'calculation_detail,' : ''}
      organization_members(id, name, rank)
      `,
    )
    .eq('year_month', yearMonth)
    .order('total_amount', { ascending: false });

  if (memberId) query = query.eq('member_id', memberId);
  if (rank) query = query.eq('rank', rank);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, year_month: yearMonth });
}
