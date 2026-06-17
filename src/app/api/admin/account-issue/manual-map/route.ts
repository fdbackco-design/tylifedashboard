import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { backfillMemberPhoneFromUserProfile } from '@/lib/account-issue/member-profile-repair';

/**
 * 관리자 수동 매핑 / 매핑 해제 API
 *
 * action:
 *   - 'map'    : { user_profile_id, member_id } 를 받아서 MATCHED 로 전환
 *   - 'unmap'  : { user_profile_id } 를 받아서 PENDING 으로 되돌리고 member_id 비움
 *
 * 충돌 방지:
 *   - 동일 member_id 가 이미 다른 user_profiles 에 매핑되어 있으면 409 로 거부한다.
 *   - 매핑 해제 후 pre_issued_name 이 비어있으면 display_name 을 pre_issued_name 으로 보존한다.
 */

type Body =
  | { action: 'map'; user_profile_id: string; member_id: string }
  | { action: 'unmap'; user_profile_id: string };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  if (!body || !body.action || !('user_profile_id' in body) || !body.user_profile_id) {
    return NextResponse.json({ success: false, error: 'user_profile_id 필수' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  try {
    if (body.action === 'map') {
      const { user_profile_id, member_id } = body;
      if (!member_id) {
        return NextResponse.json({ success: false, error: 'member_id 필수' }, { status: 400 });
      }

      // 1) 다른 user_profiles 에 이미 매핑되어 있으면 거부
      const { data: dup, error: dupErr } = await db
        .from('user_profiles')
        .select('id')
        .eq('member_id', member_id)
        .neq('id', user_profile_id)
        .limit(1)
        .maybeSingle();
      if (dupErr) throw new Error(dupErr.message);
      if (dup?.id) {
        return NextResponse.json(
          { success: false, error: '해당 사람은 이미 다른 계정에 매핑되어 있습니다.' },
          { status: 409 },
        );
      }

      // 2) 대상 user_profiles + organization_members 의 이름/연락처를 보강
      const [profileRes, memberRes] = await Promise.all([
        db
          .from('user_profiles')
          .select('id, display_name, pre_issued_name, pre_issued_phone, phone')
          .eq('id', user_profile_id)
          .maybeSingle(),
        db
          .from('organization_members')
          .select('id, name, phone, source_customer_id')
          .eq('id', member_id)
          .maybeSingle(),
      ]);
      if (profileRes.error) throw new Error(profileRes.error.message);
      if (memberRes.error) throw new Error(memberRes.error.message);
      if (!profileRes.data) {
        return NextResponse.json({ success: false, error: '대상 user_profiles 가 없습니다.' }, { status: 404 });
      }
      if (!memberRes.data) {
        return NextResponse.json({ success: false, error: '대상 organization_members 가 없습니다.' }, { status: 404 });
      }
      const profile = profileRes.data as any;
      const member = memberRes.data as any;

      // 3) customer_id 보강 (source_customer_id 가 있으면 함께 채워준다)
      const customerId = (member.source_customer_id ?? null) as string | null;

      const updates: Record<string, unknown> = {
        member_id,
        customer_id: customerId,
        mapping_status: 'MATCHED',
        matched_at: new Date().toISOString(),
        matched_by: 'ADMIN',
        mapping_reason: 'ADMIN_MANUAL_MATCH',
        // display_name 이 비어있다면 organization_members 기준으로 채움
        display_name: profile.display_name ?? member.name ?? null,
        phone: profile.phone ?? member.phone ?? null,
      };

      const { error: uErr } = await db
        .from('user_profiles')
        .update(updates)
        .eq('id', user_profile_id);
      if (uErr) throw new Error(uErr.message);

      await backfillMemberPhoneFromUserProfile(db, member_id);

      // 4) 감사 로그
      await db.from('account_mapping_logs').insert({
        action: 'ADMIN_MANUAL_MAP',
        user_profile_id,
        member_id,
        pre_issued_name: profile.pre_issued_name ?? null,
        pre_issued_phone: profile.pre_issued_phone ?? null,
        mapping_status: 'MATCHED',
        matched_by: 'ADMIN',
        candidate_type: null,
        reason: 'ADMIN_MANUAL_MATCH',
        admin_id: null,
      });

      return NextResponse.json({ success: true, data: { mapping_status: 'MATCHED' } });
    }

    if (body.action === 'unmap') {
      const { user_profile_id } = body;

      const { data: prof, error: pErr } = await db
        .from('user_profiles')
        .select('id, member_id, display_name, pre_issued_name, pre_issued_phone, phone')
        .eq('id', user_profile_id)
        .maybeSingle();
      if (pErr) throw new Error(pErr.message);
      if (!prof) {
        return NextResponse.json({ success: false, error: '대상 user_profiles 가 없습니다.' }, { status: 404 });
      }

      const updates: Record<string, unknown> = {
        member_id: null,
        customer_id: null,
        mapping_status: 'PENDING',
        matched_at: null,
        matched_by: null,
        mapping_reason: 'ADMIN_UNMAP',
        // 사전 발급 데이터가 비어 있다면 display_name/phone 으로 보존 (재평가 시 활용)
        pre_issued_name: (prof as any).pre_issued_name ?? (prof as any).display_name ?? null,
        pre_issued_phone: (prof as any).pre_issued_phone ?? (prof as any).phone ?? null,
      };

      const { error: uErr } = await db
        .from('user_profiles')
        .update(updates)
        .eq('id', user_profile_id);
      if (uErr) throw new Error(uErr.message);

      await db.from('account_mapping_logs').insert({
        action: 'ADMIN_UNMAP',
        user_profile_id,
        member_id: (prof as any).member_id ?? null,
        pre_issued_name: (prof as any).pre_issued_name ?? null,
        pre_issued_phone: (prof as any).pre_issued_phone ?? null,
        mapping_status: 'PENDING',
        matched_by: null,
        candidate_type: null,
        reason: 'ADMIN_UNMAP',
        admin_id: null,
      });

      return NextResponse.json({ success: true, data: { mapping_status: 'PENDING' } });
    }

    return NextResponse.json({ success: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
