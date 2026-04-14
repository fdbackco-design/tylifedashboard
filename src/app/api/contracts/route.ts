/**
 * GET /api/contracts
 * 계약 목록 조회. 필터/페이지네이션 지원.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { ContractStatus } from '@/lib/types';

const PAGE_SIZE = 50;

// 계약 목록은 빈번히 조회되므로 짧은 캐시로 중복 요청 완화
export const revalidate = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const status = searchParams.get('status') as ContractStatus | null;
  const memberId = searchParams.get('member_id');
  const yearMonth = searchParams.get('year_month'); // 'YYYY-MM'
  const isCancelled = searchParams.get('is_cancelled');
  const includeCount = searchParams.get('include_count') === 'true';

  const db = createAdminSupabaseClient();

  let query = db
    .from('contracts')
    .select(
      `
      id,
      sequence_no,
      contract_code,
      join_date,
      product_type,
      unit_count,
      status,
      is_cancelled,
      watch_fit,
      happy_call_at,
      customer_id,
      sales_member_id,
      customers!inner(name),
      organization_members(name, rank)
      `,
    )
    .order('sequence_no', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status) {
    query = query.eq('status', status);
  }
  if (memberId) {
    query = query.eq('sales_member_id', memberId);
  }
  if (yearMonth) {
    // YYYY-MM 기준 가입일 필터
    query = query
      .gte('join_date', `${yearMonth}-01`)
      .lt('join_date', incrementMonth(yearMonth));
  }
  if (isCancelled !== null) {
    query = query.eq('is_cancelled', isCancelled === 'true');
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let total: number | null = null;
  let totalPages: number | null = null;

  // exact count는 비용이 큼 → 필요할 때만 opt-in
  if (includeCount) {
    let countQuery = db
      .from('contracts')
      .select('id', { count: 'exact', head: true });

    if (status) countQuery = countQuery.eq('status', status);
    if (memberId) countQuery = countQuery.eq('sales_member_id', memberId);
    if (yearMonth) {
      countQuery = countQuery
        .gte('join_date', `${yearMonth}-01`)
        .lt('join_date', incrementMonth(yearMonth));
    }
    if (isCancelled !== null) {
      countQuery = countQuery.eq('is_cancelled', isCancelled === 'true');
    }

    const { count: c, error: countErr } = await countQuery;
    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }
    total = c ?? 0;
    totalPages = Math.ceil((total ?? 0) / PAGE_SIZE);
  }

  return NextResponse.json(
    {
      data,
      pagination: {
        page,
        page_size: PAGE_SIZE,
        ...(includeCount ? { total, total_pages: totalPages } : {}),
      },
    },
  );
}

function incrementMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return `${next}-01`;
}
