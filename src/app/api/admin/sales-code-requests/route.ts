/**
 * GET /api/admin/sales-code-requests
 *
 * 영업자 코드 발급 신청 전체 목록 (관리자용).
 * 쿼리 파라미터(모두 옵션):
 *   - status=신청중,시트등록완료,...  쉼표로 다중 가능
 *   - applicant=홍길동                신청자 이름 부분일치
 *   - from=YYYY-MM-DD                 requested_at >= from 00:00 (Asia/Seoul 기준 단순화: UTC 비교)
 *   - to=YYYY-MM-DD                   requested_at <= to 23:59:59
 *   - limit (기본 200, 최대 1000)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const statusParam = (url.searchParams.get('status') ?? '').trim();
  const applicant = (url.searchParams.get('applicant') ?? '').trim();
  const from = (url.searchParams.get('from') ?? '').trim();
  const to = (url.searchParams.get('to') ?? '').trim();
  const limit = Math.min(
    1000,
    Math.max(1, Math.floor(Number(url.searchParams.get('limit') ?? '200')) || 200),
  );

  const db = createAdminSupabaseClient();
  let q = db
    .from('sales_code_requests')
    .select(
      [
        'id',
        'applicant_user_id',
        'applicant_member_id',
        'applicant_name',
        'name',
        'birth_date',
        'gender',
        'phone',
        'phone_digits',
        'has_own_contract',
        'memo',
        'status',
        'requested_at',
        'synced_to_sheet',
        'sheet_synced_at',
        'sheet_synced_by',
        'rejection_reason',
        'rejected_at',
        'rejected_by',
      ].join(', '),
    )
    .order('requested_at', { ascending: false })
    .limit(limit);

  if (statusParam) {
    const arr = statusParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (arr.length > 0) q = q.in('status', arr);
  }
  if (applicant) {
    const like = `%${applicant.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    q = q.ilike('applicant_name', like);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    q = q.gte('requested_at', `${from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    q = q.lte('requested_at', `${to}T23:59:59.999Z`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
