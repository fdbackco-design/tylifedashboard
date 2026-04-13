/**
 * GET /api/contracts
 * 계약 목록 조회. 필터/페이지네이션 지원.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import type { ContractStatus } from '@/lib/types';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const status = searchParams.get('status') as ContractStatus | null;
  const memberId = searchParams.get('member_id');
  const yearMonth = searchParams.get('year_month'); // 'YYYY-MM'
  const isCancelled = searchParams.get('is_cancelled');

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
      { count: 'exact' },
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

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    pagination: {
      page,
      page_size: PAGE_SIZE,
      total: count ?? 0,
      total_pages: Math.ceil((count ?? 0) / PAGE_SIZE),
    },
  });
}

function incrementMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return `${next}-01`;
}
