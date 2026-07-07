/**
 * POST /api/admin/account-mapping/repair
 *
 * organization_members ↔ user_profiles 정합성 복구 API.
 *
 * Body 패턴:
 *   1) { profileId: string, newMemberId: string }
 *      - user_profiles.member_id 를 newMemberId 로 갱신
 *      - display_name 의 "[고객] " 접두어 제거
 *      - newMemberId.source_customer_id 가 있다면 같은 customer 의 옛 임시 노드 안전 비활성화
 *
 *   2) { deactivateLegacyMemberId: string }
 *      - 해당 멤버가 "옛 임시 customer 노드(external_id LIKE 'customer:%')" 이고
 *        모든 참조가 0건이면 is_active = false 로 처리
 *      - 참조가 남아 있으면 비활성화하지 않고 references 카운트만 반환
 *
 * 정산 계산/계약/조직도 수동 편집 결과는 변경하지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  deactivateLegacyCustomerNodesIfSafe,
  isLegacyMemberSafeToDeactivate,
  repairUserProfileMembership,
} from '@/lib/account-issue/member-profile-repair';
import { promotePreIssuedPendingSettingIfPossible } from '@/lib/pre-issued/pending-promote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BodyShape {
  profileId?: string;
  newMemberId?: string;
  deactivateLegacyMemberId?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ ok: false, message: 'unauthorized' }, { status: 401 });
  }
  let body: BodyShape;
  try {
    body = (await req.json()) as BodyShape;
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid_json' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  // ── 패턴 2: 옛 customer 노드 비활성화 ─────────────────────────
  if (body.deactivateLegacyMemberId) {
    const memberId = String(body.deactivateLegacyMemberId).trim();
    if (!memberId) {
      return NextResponse.json({ ok: false, message: 'memberId 가 필요합니다.' }, { status: 400 });
    }

    // "옛 임시 customer 노드" 인지 확인 (external_id LIKE 'customer:%').
    const { data: member, error: mErr } = await db
      .from('organization_members')
      .select('id, external_id, source_customer_id, is_active')
      .eq('id', memberId)
      .maybeSingle();
    if (mErr) return NextResponse.json({ ok: false, message: mErr.message }, { status: 500 });
    if (!member) return NextResponse.json({ ok: false, message: '멤버를 찾을 수 없습니다.' }, { status: 404 });
    const m = member as {
      id: string;
      external_id: string | null;
      source_customer_id: string | null;
      is_active: boolean;
    };
    if (!(m.external_id ?? '').startsWith('customer:')) {
      return NextResponse.json(
        { ok: false, message: '이 API 는 옛 임시 customer 노드 (external_id LIKE \'customer:%\') 에만 사용할 수 있습니다.' },
        { status: 400 },
      );
    }

    const safety = await isLegacyMemberSafeToDeactivate(db, memberId);
    if (!safety.safe) {
      return NextResponse.json(
        { ok: true, deactivated: false, references: safety.references, message: '참조가 남아 있어 비활성화하지 않았습니다.' },
        { status: 200 },
      );
    }

    // 빈 monthly_settlements 행 정리 후 비활성화
    await db
      .from('monthly_settlements')
      .delete()
      .eq('member_id', memberId)
      .eq('direct_unit_count', 0)
      .eq('total_amount', 0);
    const { error: upErr } = await db
      .from('organization_members')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', memberId);
    if (upErr) {
      return NextResponse.json({ ok: false, message: upErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deactivated: true });
  }

  // ── 패턴 1: user_profiles 재매핑 ─────────────────────────────
  const profileId = String(body.profileId ?? '').trim();
  const newMemberId = String(body.newMemberId ?? '').trim();
  if (!profileId || !newMemberId) {
    return NextResponse.json(
      { ok: false, message: 'profileId 와 newMemberId 가 필요합니다.' },
      { status: 400 },
    );
  }

  // 안전 검사: newMemberId 가 active 인지
  const { data: newMember, error: nmErr } = await db
    .from('organization_members')
    .select('id, is_active, source_customer_id, rank')
    .eq('id', newMemberId)
    .maybeSingle();
  if (nmErr) return NextResponse.json({ ok: false, message: nmErr.message }, { status: 500 });
  if (!newMember) {
    return NextResponse.json({ ok: false, message: '대상 멤버를 찾을 수 없습니다.' }, { status: 404 });
  }
  const nm = newMember as {
    id: string;
    is_active: boolean;
    source_customer_id: string | null;
    rank: string | null;
  };
  if (!nm.is_active) {
    return NextResponse.json({ ok: false, message: '대상 멤버가 비활성 상태입니다.' }, { status: 400 });
  }

  const r = await repairUserProfileMembership(db, { profileId, newMemberId });
  if (!r.ok) return NextResponse.json({ ok: false, message: r.message }, { status: 500 });

  // 코드 선발급 "예약 등록" 승격(있으면 자동 적용)
  try {
    await promotePreIssuedPendingSettingIfPossible({
      db,
      userProfileId: profileId,
      changedBy: 'ADMIN_REPAIR',
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[account-mapping/repair] pre-issued pending promote failed (repair is ok):', e);
  }

  // 같은 customer 의 옛 임시 노드 자동 비활성화 (안전 조건 충족 시)
  let deactivatedMemberIds: string[] = [];
  let skipped: Array<{ memberId: string; references: Record<string, number> }> = [];
  if (nm.source_customer_id) {
    const res = await deactivateLegacyCustomerNodesIfSafe(db, {
      customerId: nm.source_customer_id,
      keepMemberId: nm.id,
    });
    deactivatedMemberIds = res.deactivatedMemberIds;
    skipped = res.skipped;
  }

  return NextResponse.json({
    ok: true,
    repairedProfileId: profileId,
    newMemberId,
    deactivatedMemberIds,
    skipped,
  });
}
