/**
 * UI preference for settlement page:
 * - GET  /api/settlement/self-contract-preferences?year_month=YYYY-MM
 * - PUT  /api/settlement/self-contract-preferences  { year_month, top_line_id, included }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const isYearMonth = (v: string | null): v is string => !!v && /^\d{4}-\d{2}$/.test(v);
const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const yearMonth = req.nextUrl.searchParams.get('year_month');
  if (!isYearMonth(yearMonth)) {
    return NextResponse.json({ error: 'year_month 파라미터가 필요합니다 (형식: YYYY-MM)' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from('settlement_self_contract_preferences')
    .select('top_line_id, included')
    .eq('year_month', yearMonth);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ year_month: yearMonth, data: data ?? [] });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  let body: { year_month?: string; top_line_id?: string; included?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const yearMonth = (body.year_month ?? '').trim();
  const topLineId = (body.top_line_id ?? '').trim();
  const included = body.included;

  if (!isYearMonth(yearMonth)) {
    return NextResponse.json({ error: 'year_month(YYYY-MM) 필요' }, { status: 400 });
  }
  if (!topLineId || !isUuid(topLineId)) {
    return NextResponse.json({ error: 'top_line_id(UUID) 필요' }, { status: 400 });
  }
  if (typeof included !== 'boolean') {
    return NextResponse.json({ error: 'included(boolean) 필요' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { error } = await db
    .from('settlement_self_contract_preferences')
    .upsert(
      { year_month: yearMonth, top_line_id: topLineId, included, updated_at: new Date().toISOString() } as any,
      { onConflict: 'year_month,top_line_id' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, year_month: yearMonth, top_line_id: topLineId, included });
}

