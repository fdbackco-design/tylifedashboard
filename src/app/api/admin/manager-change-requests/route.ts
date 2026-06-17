/**
 * GET /api/admin/manager-change-requests
 * 관리자: 담당자 변경 신청 전체 목록
 *
 * Query: status=PENDING|COMPLETED| (전체는 생략)
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const SELECT_FIELDS = [
  'id',
  'requester_user_id',
  'requester_member_id',
  'requester_name',
  'requester_phone',
  'contract_id',
  'customer_id',
  'customer_name',
  'resident_number',
  'customer_phone',
  'account_count',
  'contract_codes',
  'item_name',
  'branch_name',
  'before_manager_name',
  'before_manager_phone',
  'after_manager_name',
  'after_manager_phone',
  'status',
  'created_at',
  'updated_at',
  'completed_at',
  'completed_by_admin_id',
].join(', ');

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const status = (new URL(req.url).searchParams.get('status') ?? '').trim().toUpperCase();
  const db = createAdminSupabaseClient();
  let q = db.from('manager_change_requests').select(SELECT_FIELDS).order('created_at', { ascending: false }).limit(500);

  if (status === 'PENDING' || status === 'COMPLETED') {
    q = q.eq('status', status);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
