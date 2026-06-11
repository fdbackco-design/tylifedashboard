/**
 * /api/me/sales-code-requests
 *
 * GET  : 로그인 영업자 본인의 신청 내역 (최신순)
 * POST : 신청 생성
 *
 * 본인 확인: Supabase Auth user.id → user_profiles.member_id, display_name
 *   - applicant_user_id, applicant_member_id, applicant_name 은 서버가 자동 채운다.
 *   - 신청 직후 status = '신청중' (DB default)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

type MeContext = {
  userId: string;
  memberId: string | null;
  displayName: string | null;
};

async function getMe(): Promise<MeContext | { error: 'unauthorized' } | { error: string }> {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: 'unauthorized' };
  const { data: profile, error } = await db
    .from('user_profiles')
    .select('member_id, display_name, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return { error: error.message };
  return {
    userId: user.id,
    memberId: (profile?.member_id as string | null) ?? null,
    displayName: (profile?.display_name as string | null) ?? null,
  };
}

export async function GET(): Promise<NextResponse> {
  const me = await getMe();
  if ('error' in me) {
    if (me.error === 'unauthorized') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ error: me.error }, { status: 500 });
  }

  const adminDb = createAdminSupabaseClient();
  const { data, error } = await adminDb
    .from('sales_code_requests')
    .select(
      'id, name, birth_date, gender, phone, has_own_contract, memo, status, requested_at, synced_to_sheet, sheet_synced_at, rejection_reason, rejected_at',
    )
    .eq('applicant_user_id', me.userId)
    .order('requested_at', { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

const BIRTH_RE = /^\d{8}$/;
const PHONE_RE = /^\d{10,11}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await getMe();
  if ('error' in me) {
    if (me.error === 'unauthorized') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ error: me.error }, { status: 500 });
  }

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

  // 신청자 이름은 user_profiles.display_name 우선, 없으면 organization_members.name 폴백
  const adminDb = createAdminSupabaseClient();
  let applicantName = me.displayName?.trim() || '';
  if (!applicantName && me.memberId) {
    const { data: m } = await adminDb
      .from('organization_members')
      .select('name')
      .eq('id', me.memberId)
      .maybeSingle();
    applicantName = ((m as { name?: string } | null)?.name ?? '').trim();
  }
  if (!applicantName) applicantName = 'unknown';

  const phoneDisplay = phoneDigits.length === 11
    ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 7)}-${phoneDigits.slice(7)}`
    : phoneDigits.length === 10
    ? `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`
    : phoneRaw;

  const insertRow = {
    applicant_user_id: me.userId,
    applicant_member_id: me.memberId,
    applicant_name: applicantName,
    name,
    birth_date: birth,
    gender,
    phone: phoneDisplay,
    phone_digits: phoneDigits,
    has_own_contract: hasOwn,
    memo,
  };

  const { data, error } = await adminDb
    .from('sales_code_requests')
    .insert(insertRow)
    .select(
      'id, name, birth_date, gender, phone, has_own_contract, memo, status, requested_at, synced_to_sheet, sheet_synced_at, rejection_reason, rejected_at',
    )
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
