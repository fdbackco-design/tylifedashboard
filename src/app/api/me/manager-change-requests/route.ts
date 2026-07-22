/**
 * /api/me/manager-change-requests
 *
 * GET  : 본인 신청 이력
 * POST : 담당자 변경 신청 생성
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import {
  assertContractsInMemberDownstream,
  buildManagerChangeSelectionFromContractIds,
  loadDownstreamContractsForMember,
} from '@/lib/manager-change/downstream-contracts';
import { MANAGER_CHANGE_BRANCH_NAME, formatPhoneDisplay } from '@/lib/manager-change/format';
import { notifyAdminsOfManagerChangeRequest } from '@/lib/manager-change/notify';

type MeContext = {
  userId: string;
  memberId: string | null;
  displayName: string | null;
  phone: string | null;
};

const PHONE_RE = /^\d{10,11}$/;
const REQUEST_SELECT =
  'id, contract_id, customer_name, contract_codes, item_name, after_manager_name, after_manager_phone, status, created_at, completed_at, rejection_reason, rejected_at';

async function getMe(): Promise<MeContext | { error: 'unauthorized' } | { error: string }> {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: 'unauthorized' };
  const { data: profile, error } = await db
    .from('user_profiles')
    .select('member_id, display_name, phone, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) return { error: error.message };
  return {
    userId: user.id,
    memberId: (profile?.member_id as string | null) ?? null,
    displayName: (profile?.display_name as string | null) ?? null,
    phone: (profile?.phone as string | null) ?? null,
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
    .from('manager_change_requests')
    .select(REQUEST_SELECT)
    .eq('requester_user_id', me.userId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await getMe();
  if ('error' in me) {
    if (me.error === 'unauthorized') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ error: me.error }, { status: 500 });
  }
  if (!me.memberId) {
    return NextResponse.json({ error: '조직 매핑이 완료된 후 신청할 수 있습니다.' }, { status: 403 });
  }

  let body: {
    contract_id?: string;
    contract_ids?: string[];
    after_manager_name?: string;
    after_manager_phone?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const contractIds = (() => {
    if (Array.isArray(body.contract_ids) && body.contract_ids.length > 0) {
      return body.contract_ids.map((id) => String(id).trim()).filter(Boolean);
    }
    const single = (body.contract_id ?? '').trim();
    return single ? [single] : [];
  })();

  const afterName = (body.after_manager_name ?? '').trim();
  const afterPhoneRaw = (body.after_manager_phone ?? '').trim();
  const afterPhoneDigits = afterPhoneRaw.replace(/\D/g, '');

  if (contractIds.length === 0) return NextResponse.json({ error: '계약을 선택하세요.' }, { status: 400 });
  if (!afterName) return NextResponse.json({ error: '변경 후 담당자명을 입력하세요.' }, { status: 400 });
  if (!PHONE_RE.test(afterPhoneDigits)) {
    return NextResponse.json({ error: '변경 후 담당자 연락처를 올바르게 입력하세요.' }, { status: 400 });
  }

  const adminDb = createAdminSupabaseClient();

  const inSubtree = await assertContractsInMemberDownstream(adminDb, me.memberId, contractIds);
  if (!inSubtree) {
    return NextResponse.json({ error: '선택한 계약에 접근할 수 없습니다.' }, { status: 403 });
  }

  const contracts = await loadDownstreamContractsForMember(adminDb, me.memberId);
  const selection = buildManagerChangeSelectionFromContractIds(contracts, contractIds);
  if (!selection) {
    return NextResponse.json(
      { error: '선택한 계약은 동일 고객·연락처·가입일·담당자·상품명이어야 합니다.' },
      { status: 400 },
    );
  }

  const { data: pendingDup } = await adminDb
    .from('manager_change_requests')
    .select('id')
    .eq('requester_user_id', me.userId)
    .eq('selection_group_key', selection.selection_group_key)
    .eq('status', 'PENDING')
    .limit(1)
    .maybeSingle();
  if (pendingDup?.id) {
    return NextResponse.json(
      { error: '동일 조건의 담당자 변경 신청이 이미 진행 중입니다.' },
      { status: 409 },
    );
  }

  let requesterName = me.displayName?.trim() || '';
  let requesterPhone = me.phone?.trim() || '';
  if ((!requesterName || !requesterPhone) && me.memberId) {
    const { data: m } = await adminDb
      .from('organization_members')
      .select('name, phone')
      .eq('id', me.memberId)
      .maybeSingle();
    if (!requesterName) requesterName = ((m as { name?: string } | null)?.name ?? '').replace(/^\[고객\]\s*/, '').trim();
    if (!requesterPhone) requesterPhone = (m as { phone?: string | null } | null)?.phone ?? '';
  }
  if (!requesterName) requesterName = 'unknown';

  const afterPhoneDisplay = formatPhoneDisplay(afterPhoneDigits);
  const requesterPhoneDisplay = requesterPhone ? formatPhoneDisplay(requesterPhone.replace(/\D/g, '')) : null;

  const insertRow = {
    requester_user_id: me.userId,
    requester_member_id: me.memberId,
    requester_name: requesterName,
    requester_phone: requesterPhoneDisplay,
    contract_id: selection.contract_id,
    customer_id: selection.customer_id,
    customer_name: selection.customer_name,
    resident_number: selection.resident_number,
    customer_phone: selection.customer_phone,
    join_date: selection.join_date,
    selection_group_key: selection.selection_group_key,
    account_count: selection.account_count,
    contract_codes: selection.contract_codes,
    item_name: selection.item_name,
    branch_name: MANAGER_CHANGE_BRANCH_NAME,
    before_manager_name: requesterName,
    before_manager_phone: requesterPhoneDisplay,
    after_manager_name: afterName,
    after_manager_phone: afterPhoneDisplay,
    status: 'PENDING',
  };

  const { data, error } = await adminDb
    .from('manager_change_requests')
    .insert(insertRow)
    .select(REQUEST_SELECT)
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: '동일 조건의 담당자 변경 신청이 이미 진행 중입니다.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const createdId = ((data as { id?: string } | null)?.id ?? '').trim();
  if (createdId) {
    try {
      await notifyAdminsOfManagerChangeRequest(adminDb, createdId);
    } catch (e) {
      console.error('[manager-change-requests] admin notify failed', e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json({ item: data });
}
