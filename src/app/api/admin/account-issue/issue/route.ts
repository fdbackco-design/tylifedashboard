import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

type Body = {
  /** 없거나 빈 문자열이면 null 저장(organization_members만 있는 조직원도 발급 가능) */
  customer_id?: string | null;
  member_id: string;
  login_code: string; // 8자리 숫자(요구사항) — 내부적으로 auth email로 변환됨
  password: string;
  is_active: boolean;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthed(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  const { member_id, login_code, password, is_active } = body;
  const customerIdRaw =
    typeof body.customer_id === 'string' ? body.customer_id.trim() : (body.customer_id ?? null);
  const customer_id = customerIdRaw && customerIdRaw.length > 0 ? customerIdRaw : null;

  if (!member_id || !login_code || !password) {
    return NextResponse.json({ success: false, error: 'missing fields' }, { status: 400 });
  }

  const EMAIL_DOMAIN = 'tylifedashboard.local';
  const extractDigits8 = (v: string): string | null => {
    const local = v.includes('@') ? v.split('@')[0] : v;
    return /^\d{8}$/.test(local) ? local : null;
  };

  // 요구사항: login_code/password는 8자리 숫자여야 함
  const digits = extractDigits8(login_code);
  if (!digits) {
    return NextResponse.json({ success: false, error: 'login_code must be 8-digit number' }, { status: 400 });
  }
  const passwordDigits = extractDigits8(password);
  if (!passwordDigits || passwordDigits !== digits) {
    return NextResponse.json({ success: false, error: 'password must be the same 8-digit number as login_code' }, { status: 400 });
  }

  // Supabase Auth는 email이 필요하므로 내부적으로만 email 생성
  const authEmail = `${digits}@${EMAIL_DOMAIN}`;

  const db = createAdminSupabaseClient();

  try {
    // 0) 이미 같은 member_id로 발급된 계정이 있으면 새로 만들지 않고 기존 반환
    const { data: existingProfile } = await db
      .from('user_profiles')
      .select('id, is_active')
      .eq('member_id', member_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingProfile?.id) {
      // 활성 상태만 최신 요청값으로 동기화
      await db.from('user_profiles').update({ is_active }).eq('id', existingProfile.id);
      return NextResponse.json({ success: true, data: { user_id: existingProfile.id, existed: true } });
    }

    // 1) auth.users 생성
    const created = await db.auth.admin.createUser({
      email: authEmail,
      password: digits,
      email_confirm: true,
      user_metadata: { member_id },
    });

    if (created.error) {
      const msg = created.error.message ?? 'createUser failed';
      // 이메일 중복 등
      return NextResponse.json({ success: false, error: msg }, { status: 409 });
    }

    const userId = created.data.user?.id;
    if (!userId) throw new Error('auth user id missing');

    // 2) display/phone 보강(조직원 우선, customer_id가 있을 때만 customers 조회)
    const memberRes = await db.from('organization_members').select('id, name, rank, phone').eq('id', member_id).maybeSingle();
    const member = (memberRes.data ?? null) as any;

    let customer: any = null;
    if (customer_id) {
      const customerRes = await db.from('customers').select('id, name, phone').eq('id', customer_id).maybeSingle();
      customer = customerRes.data ?? null;
    }

    const profile = {
      id: userId,
      customer_id,
      member_id,
      login_code: digits,
      display_name: member?.name ?? customer?.name ?? null,
      phone: member?.phone ?? customer?.phone ?? null,
      role: 'member',
      is_active: !!is_active,
      must_change_password: true,
    };

    const ins = await db.from('user_profiles').insert(profile);
    if (ins.error) throw new Error(ins.error.message);

    return NextResponse.json({ success: true, data: { user_id: userId } });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

