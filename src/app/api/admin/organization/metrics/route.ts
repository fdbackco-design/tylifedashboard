import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { computeAdminOrgNodeMetrics } from '@/lib/organization/compute-admin-org-metrics';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requested =
    coalesceYearMonthSearchParam(url.searchParams.get('year_month') ?? undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requested) ?? defaultYearMonth;

  try {
    const db = createAdminSupabaseClient();
    const metricsById = await computeAdminOrgNodeMetrics(db, yearMonth);
    return NextResponse.json({ year_month: yearMonth, metricsById });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'metrics computation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
