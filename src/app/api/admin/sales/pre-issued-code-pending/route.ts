import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { promotePreIssuedPendingSettingIfPossible } from '@/lib/pre-issued/pending-promote';

type Status = 'active' | 'paused' | 'ended';

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(v);
}

function bad(msg: string, status: number = 400): NextResponse {
  return NextResponse.json({ success: false, error: msg }, { status });
}

function toYmd(v: unknown): string {
  return String(v ?? '').slice(0, 10);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return bad('Unauthorized', 401);
  const db = createAdminSupabaseClient();
  const sp = req.nextUrl.searchParams;
  const userProfileId = (sp.get('user_profile_id') ?? '').trim();
  if (userProfileId) {
    if (!isUuid(userProfileId)) return bad('user_profile_id는 UUID여야 합니다.');
    const { data: setting, error: sErr } = await db
      .from('pre_issued_code_pending_settings')
      .select('*')
      .eq('user_profile_id', userProfileId)
      .maybeSingle();
    if (sErr) return bad(sErr.message, 500);
    const { data: history, error: hErr } = await db
      .from('pre_issued_code_pending_settings_audit')
      .select('id, pending_setting_id, user_profile_id, changed_at, changed_by, change_reason, before_json, after_json')
      .eq('user_profile_id', userProfileId)
      .order('changed_at', { ascending: false })
      .limit(50);
    if (hErr) return bad(hErr.message, 500);
    return NextResponse.json({ success: true, data: { setting, history: history ?? [] } });
  }
  const { data, error } = await db
    .from('pre_issued_code_pending_settings')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(5000);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ success: true, data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return bad('Unauthorized', 401);
  const db = createAdminSupabaseClient();
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return bad('Invalid JSON');
  }

  const action = String(body.action ?? 'upsert').trim();
  const changed_by_raw = String(body.changed_by ?? '').trim();
  const changed_by = isUuid(changed_by_raw) ? changed_by_raw : null;

  if (action === 'promote') {
    const user_profile_id = String(body.user_profile_id ?? '').trim();
    if (!isUuid(user_profile_id)) return bad('user_profile_id는 UUID여야 합니다.');
    const res = await promotePreIssuedPendingSettingIfPossible({
      db,
      userProfileId: user_profile_id,
      changedBy: changed_by ?? '',
    });
    return NextResponse.json({ success: res.ok && res.promoted, message: res.message });
  }

  const user_profile_id = String(body.user_profile_id ?? '').trim();
  const desired_parent_leader_member_id = String(body.desired_parent_leader_member_id ?? '').trim();
  const reason = String(body.reason ?? '').trim();
  const desired_status = (String(body.desired_status ?? 'active') as Status).trim() as Status;
  const effective_from = toYmd(body.effective_from) || toYmd(new Date().toISOString());
  const effective_to = body.effective_to ? toYmd(body.effective_to) : null;
  const special_unit_price = Number(body.special_unit_price ?? 100000);
  const special_unit_limit = Number(body.special_unit_limit ?? 10);
  const note = body.note != null ? String(body.note) : null;
  const change_reason = String(body.change_reason ?? 'CREATE').trim() || 'CREATE';

  if (!isUuid(user_profile_id)) return bad('user_profile_id는 UUID여야 합니다.');
  if (!isUuid(desired_parent_leader_member_id)) return bad('desired_parent_leader_member_id는 UUID여야 합니다.');
  if (!reason) return bad('사유(reason)는 필수입니다.');
  if (!['active', 'paused', 'ended'].includes(desired_status)) return bad('desired_status 값이 올바르지 않습니다.');
  if (!Number.isFinite(special_unit_price) || special_unit_price <= 0) return bad('적용단가(special_unit_price)는 0보다 커야 합니다.');
  if (!Number.isFinite(special_unit_limit) || special_unit_limit <= 0) return bad('적용구좌(special_unit_limit)는 0보다 커야 합니다.');
  if (effective_to && effective_to < effective_from) return bad('종료일은 시작일 이후여야 합니다.');

  const { data: profile, error: pfErr } = await db
    .from('user_profiles')
    .select('id, member_id')
    .eq('id', user_profile_id)
    .maybeSingle();
  if (pfErr) return bad(pfErr.message, 500);
  if (!profile) return bad('user_profile을 찾을 수 없습니다.');
  if ((profile as any).member_id != null) {
    // 이미 매핑된 경우는 "예약"이 아니라 즉시 본 설정으로 저장하는 것이 맞다.
    return bad('이미 member_id가 매핑된 계정입니다. (예약 대신 일반 등록을 사용하세요)');
  }

  const { data: before } = await db
    .from('pre_issued_code_pending_settings')
    .select('*')
    .eq('user_profile_id', user_profile_id)
    .maybeSingle();

  const upsertPayload = {
    user_profile_id,
    desired_parent_leader_member_id,
    reason,
    special_unit_price: Math.round(special_unit_price),
    special_unit_limit: Math.round(special_unit_limit),
    effective_from,
    effective_to,
    desired_status,
    note,
    promoted: false,
    updated_at: new Date().toISOString(),
    updated_by: changed_by,
  } as any;

  const { data: after, error: upErr } = await db
    .from('pre_issued_code_pending_settings')
    .upsert(upsertPayload, { onConflict: 'user_profile_id' })
    .select('*')
    .single();
  if (upErr) return bad(upErr.message, 500);

  try {
    await db.from('pre_issued_code_pending_settings_audit').insert({
      pending_setting_id: (after as any).id,
      user_profile_id,
      changed_by,
      change_reason,
      before_json: before ?? null,
      after_json: after ?? null,
    } as any);
  } catch (e) {
    console.warn('[pre-issued-code][pending] audit insert failed', e);
  }

  return NextResponse.json({ success: true, data: after });
}

