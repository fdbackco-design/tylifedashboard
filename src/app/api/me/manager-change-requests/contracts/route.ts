/**
 * GET /api/me/manager-change-requests/contracts
 * 로그인 영업자 산하 계약 목록
 */

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { loadDownstreamContractsForMember } from '@/lib/manager-change/downstream-contracts';

async function getMeMemberId(): Promise<{ memberId: string } | { error: 'unauthorized' } | { error: string }> {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: 'unauthorized' };
  const { data: profile, error } = await db
    .from('user_profiles')
    .select('member_id, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return { error: error.message };
  const memberId = (profile?.member_id as string | null) ?? null;
  if (!memberId) return { error: 'member_not_mapped' };
  return { memberId };
}

export async function GET(): Promise<NextResponse> {
  const me = await getMeMemberId();
  if ('error' in me) {
    if (me.error === 'unauthorized') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (me.error === 'member_not_mapped') {
      return NextResponse.json({ error: '조직 매핑이 완료된 후 이용할 수 있습니다.' }, { status: 403 });
    }
    return NextResponse.json({ error: me.error }, { status: 500 });
  }

  try {
    const adminDb = createAdminSupabaseClient();
    const contracts = await loadDownstreamContractsForMember(adminDb, me.memberId);
    return NextResponse.json({ contracts });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
