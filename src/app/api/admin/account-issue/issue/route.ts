import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

type Body = {
  customer_id: string;
  member_id: string;
  login_code: string; // email 형태
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

  const { customer_id, member_id, login_code, password, is_active } = body;
  if (!customer_id || !member_id || !login_code || !password) {
    return NextResponse.json({ success: false, error: 'missing fields' }, { status: 400 });
  }
  if (!login_code.includes('@')) {
    return NextResponse.json({ success: false, error: 'login_code must be email' }, { status: 400 });
  }

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
      email: login_code,
      password,
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

    // 2) display/phone 보강
    const [memberRes, customerRes] = await Promise.all([
      db.from('organization_members').select('id, name, rank, phone').eq('id', member_id).maybeSingle(),
      db.from('customers').select('id, name, phone').eq('id', customer_id).maybeSingle(),
    ]);

    const member = (memberRes.data ?? null) as any;
    const customer = (customerRes.data ?? null) as any;

    const profile = {
      id: userId,
      customer_id,
      member_id,
      login_code,
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

