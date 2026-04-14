/**
 * GET /api/settlement/[year_month]
 * 예: /api/settlement/2026-04
 *
 * 쿼리스트링 대신 path param으로 캐시 키를 명확히 해서
 * Vercel CDN에서 HIT가 안정적으로 나도록 설계.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const revalidate = 30;
export const dynamic = 'force-static';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ year_month: string }> },
): Promise<NextResponse> {
  const { year_month: yearMonth } = await ctx.params;

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json(
      { error: 'year_month 파라미터가 필요합니다 (형식: YYYY-MM)' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();
  const { data, error } = await db
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
      organization_members(id, name, rank)
      `,
    )
    .eq('year_month', yearMonth)
    .order('total_amount', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data, year_month: yearMonth });
}

