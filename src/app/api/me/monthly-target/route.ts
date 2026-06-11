/**
 * GET /api/me/monthly-target
 *   - 로그인 사용자 본인의 organization_members.monthly_target_units 조회
 *   - NULL 이면 폴백값 20 으로 응답
 *
 * PATCH /api/me/monthly-target
 *   body: { monthly_target_units: number }
 *   - 본인 user_profiles.member_id 의 organization_members.monthly_target_units 수정
 *   - 양의 정수만 허용
 *
 * 본인 확인
 *   Supabase Auth user.id → user_profiles.member_id → organization_members.id
 *   다른 사람의 값은 절대 수정할 수 없음.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';

const DEFAULT_TARGET = 20;

async function getMyMemberId(): Promise<{ memberId: string | null; userId: string | null; error?: string }> {
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();
  if (!user) return { memberId: null, userId: null, error: 'unauthorized' };
  const { data: profile, error } = await userDb
    .from('user_profiles')
    .select('member_id, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return { memberId: null, userId: user.id, error: error.message };
  const memberId = (profile?.member_id as string | null) ?? null;
  return { memberId, userId: user.id };
}

export async function GET(): Promise<NextResponse> {
  const { memberId, error } = await getMyMemberId();
  if (error === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!memberId) {
    // PENDING 계정: 목표 수정 대상 없음. 기본값만 반환.
    return NextResponse.json({
      member_id: null,
      monthly_target_units: DEFAULT_TARGET,
      is_default: true,
    });
  }

  const adminDb = createAdminSupabaseClient();
  const { data, error: rErr } = await adminDb
    .from('organization_members')
    .select('id, monthly_target_units')
    .eq('id', memberId)
    .maybeSingle();
  if (rErr) {
    return NextResponse.json({ error: rErr.message }, { status: 500 });
  }
  const raw = (data?.monthly_target_units ?? null) as number | null;
  return NextResponse.json({
    member_id: memberId,
    monthly_target_units: raw ?? DEFAULT_TARGET,
    is_default: raw == null,
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const { memberId, error } = await getMyMemberId();
  if (error === 'unauthorized') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!memberId) {
    return NextResponse.json(
      { error: '계약이 완료되지 않은 계정에서는 목표 구좌를 수정할 수 없습니다.' },
      { status: 403 },
    );
  }

  let body: { monthly_target_units?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const raw = body.monthly_target_units;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 10000) {
    return NextResponse.json(
      { error: 'monthly_target_units 는 1 이상 10000 이하 정수여야 합니다.' },
      { status: 400 },
    );
  }

  const adminDb = createAdminSupabaseClient();
  const { error: uErr } = await adminDb
    .from('organization_members')
    .update({ monthly_target_units: n })
    .eq('id', memberId);
  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }
  return NextResponse.json({
    member_id: memberId,
    monthly_target_units: n,
    is_default: false,
  });
}
