/**
 * POST /api/admin/sales-code-requests/[id]/unreject
 *
 * 관리자가 반려를 취소한다. status='반려' 인 항목만 허용.
 *
 * 복원 규칙:
 *   - issuance_status=COMPLETED 또는 completed_at 있음 → '처리완료'
 *   - 시트 동기화/작성 이력이 있거나 발급이 WAITING 이후 → '시트등록완료'
 *   - 그 외 → '신청중'
 *
 * 반려 관련 필드(rejection_reason, rejected_at, rejected_by, rejected_notified_at)는 초기화한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { findSalesCodePhoneDuplicate } from '@/lib/sales-code/phone-duplicate';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const SELECT_COLS = [
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
  'employee_id',
  'issuance_status',
  'excel_downloaded_at',
  'processing_started_at',
  'completed_at',
  'processed_by',
  'processed_by_name',
  'sheet_row_number',
  'sheet_written_at',
  'account_synced_at',
  'issuance_error',
  'retry_count',
  'rejection_reason',
  'rejected_at',
  'rejected_by',
].join(', ');

function resolveRestoredStatus(row: {
  issuance_status: string | null;
  completed_at: string | null;
  synced_to_sheet: boolean | null;
  sheet_synced_at: string | null;
  sheet_written_at: string | null;
  sheet_row_number: number | null;
  excel_downloaded_at: string | null;
}): '신청중' | '시트등록완료' | '처리완료' {
  const issuance = String(row.issuance_status ?? '').trim();
  if (issuance === 'COMPLETED' || row.completed_at) return '처리완료';
  if (
    row.synced_to_sheet ||
    row.sheet_synced_at ||
    row.sheet_written_at ||
    row.sheet_row_number != null ||
    row.excel_downloaded_at ||
    issuance === 'EXPORTED' ||
    issuance === 'PROCESSING' ||
    issuance === 'FAILED' ||
    issuance === 'SYNC_FAILED'
  ) {
    return '시트등록완료';
  }
  return '신청중';
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const db = createAdminSupabaseClient();
  const { data: cur, error: rErr } = await db
    .from('sales_code_requests')
    .select(
      [
        'id',
        'status',
        'phone_digits',
        'issuance_status',
        'completed_at',
        'synced_to_sheet',
        'sheet_synced_at',
        'sheet_written_at',
        'sheet_row_number',
        'excel_downloaded_at',
      ].join(', '),
    )
    .eq('id', id)
    .maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const row = cur as unknown as {
    id: string;
    status: string;
    phone_digits: string | null;
    issuance_status: string | null;
    completed_at: string | null;
    synced_to_sheet: boolean | null;
    sheet_synced_at: string | null;
    sheet_written_at: string | null;
    sheet_row_number: number | null;
    excel_downloaded_at: string | null;
  };

  if (row.status !== '반려') {
    return NextResponse.json({ error: '반려 상태가 아닌 신청입니다.' }, { status: 409 });
  }

  const restoredStatus = resolveRestoredStatus(row);

  try {
    const dup = await findSalesCodePhoneDuplicate(db, row.phone_digits ?? '', {
      excludeRequestId: id,
    });
    if (dup.duplicate) {
      return NextResponse.json(
        {
          error: `반려 취소 불가: ${dup.message}`,
        },
        { status: 409 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '전화번호 중복 확인 실패' },
      { status: 500 },
    );
  }

  const { data, error } = await db
    .from('sales_code_requests')
    .update({
      status: restoredStatus,
      rejection_reason: null,
      rejected_at: null,
      rejected_by: null,
      rejected_notified_at: null,
    } as any)
    .eq('id', id)
    .eq('status', '반려')
    .select(SELECT_COLS)
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
