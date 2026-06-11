/**
 * POST /api/admin/sales-code-requests/[id]/reject
 *
 * 관리자가 신청을 반려한다.
 *   body: { reason: string, changed_by?: string }
 *
 * 후처리:
 *   - status = '반려'
 *   - rejection_reason = reason
 *   - rejected_at = now()
 *   - rejected_by = changed_by || 'admin'
 *
 * 이미 '반려' 상태인 항목은 거부한다(중복 반려 방지).
 * 시트 동기화 여부와 무관하게 반려는 가능하다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_REASON_LEN = 1000;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  let body: { reason?: unknown; changed_by?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }
  const reason = (typeof body.reason === 'string' ? body.reason : '').trim();
  if (!reason) return NextResponse.json({ error: '반려 사유를 입력하세요' }, { status: 400 });
  if (reason.length > MAX_REASON_LEN) {
    return NextResponse.json({ error: `사유는 ${MAX_REASON_LEN}자 이내` }, { status: 400 });
  }
  const changedBy =
    (typeof body.changed_by === 'string' ? body.changed_by.trim() : '') || 'admin';

  const db = createAdminSupabaseClient();
  const { data: cur, error: rErr } = await db
    .from('sales_code_requests')
    .select('id, status')
    .eq('id', id)
    .maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if ((cur as { status: string }).status === '반려') {
    return NextResponse.json({ error: '이미 반려된 신청입니다.' }, { status: 409 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from('sales_code_requests')
    .update({
      status: '반려',
      rejection_reason: reason,
      rejected_at: nowIso,
      rejected_by: changedBy,
    })
    .eq('id', id)
    .not('status', 'eq', '반려')
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
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: '대상 신청을 찾을 수 없거나 상태가 변경되었습니다.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ item: data });
}
