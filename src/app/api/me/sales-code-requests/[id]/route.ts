/**
 * /api/me/sales-code-requests/[id]
 *
 * PATCH  : 본인 + 상태 '신청중' 인 신청만 수정 가능
 * DELETE : 본인 + 상태 '신청중' 인 신청만 삭제 가능
 *
 * 시트 동기화가 이미 완료된 항목(synced_to_sheet=true) 또는 '신청중' 이외 상태는 거부한다.
 * 신청자 ID/이름/요청일/상태/시트동기화 관련 필드는 사용자 입력으로 변경할 수 없다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { findSalesCodePhoneDuplicate } from '@/lib/sales-code/phone-duplicate';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BIRTH_RE = /^\d{8}$/;
const PHONE_RE = /^\d{10,11}$/;

async function getUserId(): Promise<string | null> {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.id ?? null;
}

/**
 * 본인 소유 + 신청중 상태 + 미동기화 항목인지 확인하고 row 를 반환.
 */
async function loadEditable(
  id: string,
  userId: string,
): Promise<{ ok: true; status: number; row: { id: string } } | { ok: false; status: number; error: string }> {
  if (!UUID.test(id)) return { ok: false, status: 400, error: 'invalid id' };
  const adminDb = createAdminSupabaseClient();
  const { data, error } = await adminDb
    .from('sales_code_requests')
    .select('id, applicant_user_id, status, synced_to_sheet')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'not found' };
  if ((data as { applicant_user_id: string }).applicant_user_id !== userId) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  if ((data as { synced_to_sheet: boolean }).synced_to_sheet) {
    return { ok: false, status: 409, error: '이미 시트 동기화된 신청은 수정/삭제할 수 없습니다.' };
  }
  if ((data as { status: string }).status !== '신청중') {
    return { ok: false, status: 409, error: '신청중 상태에서만 수정/삭제할 수 있습니다.' };
  }
  return { ok: true, status: 200, row: { id: (data as { id: string }).id } };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const guard = await loadEditable(id, userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let body: {
    name?: string;
    birth_date?: string;
    gender?: string;
    phone?: string;
    has_own_contract?: boolean;
    memo?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const name = (body.name ?? '').trim();
  const birth = (body.birth_date ?? '').replace(/\D/g, '');
  const gender = (body.gender ?? '').trim();
  const phoneRaw = (body.phone ?? '').trim();
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const hasOwn = body.has_own_contract === true;
  const memo = (body.memo ?? '').toString().trim() || null;

  if (!name) return NextResponse.json({ error: '이름을 입력하세요' }, { status: 400 });
  if (!BIRTH_RE.test(birth)) return NextResponse.json({ error: '생년월일은 8자리 숫자(YYYYMMDD)' }, { status: 400 });
  if (gender !== '남' && gender !== '여') return NextResponse.json({ error: '성별은 남/여' }, { status: 400 });
  if (!PHONE_RE.test(phoneDigits)) return NextResponse.json({ error: '전화번호 형식이 올바르지 않습니다' }, { status: 400 });
  if (!hasOwn && !memo) {
    return NextResponse.json(
      { error: '본인 가입구좌가 없을 경우 사유 메모를 입력하세요' },
      { status: 400 },
    );
  }

  const phoneDisplay = phoneDigits.length === 11
    ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}`
    : phoneDigits.length === 10
    ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`
    : phoneRaw;

  const adminDb = createAdminSupabaseClient();

  try {
    const dup = await findSalesCodePhoneDuplicate(adminDb, phoneDigits, {
      excludeRequestId: guard.row.id,
    });
    if (dup.duplicate) {
      return NextResponse.json({ error: dup.message }, { status: 409 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { data, error } = await adminDb
    .from('sales_code_requests')
    .update({
      name,
      birth_date: birth,
      gender,
      phone: phoneDisplay,
      phone_digits: phoneDigits,
      has_own_contract: hasOwn,
      memo,
    })
    .eq('id', guard.row.id)
    // 더블체크: 서버 race 조건 방지
    .eq('applicant_user_id', userId)
    .eq('status', '신청중')
    .eq('synced_to_sheet', false)
    .select(
      'id, name, birth_date, gender, phone, has_own_contract, memo, status, requested_at, synced_to_sheet, sheet_synced_at, rejection_reason, rejected_at',
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

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const guard = await loadEditable(id, userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const adminDb = createAdminSupabaseClient();
  const { error, count } = await adminDb
    .from('sales_code_requests')
    .delete({ count: 'exact' })
    .eq('id', guard.row.id)
    .eq('applicant_user_id', userId)
    .eq('status', '신청중')
    .eq('synced_to_sheet', false);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) {
    return NextResponse.json(
      { error: '대상 신청을 찾을 수 없거나 상태가 변경되었습니다.' },
      { status: 409 },
    );
  }
  return NextResponse.json({ deleted: true });
}
