/**
 * POST   /api/admin/contracts/[id]/settlement-sales-member
 *   - body: { settlement_sales_member_id: string | null, reason?: string, changed_by?: string }
 *   - settlement_sales_member_id 가 null 이면 override 해제
 *   - 변경 이력을 contract_settlement_sales_member_history 에 INSERT
 *
 * GET    /api/admin/contracts/[id]/settlement-sales-member
 *   - 현재 contract 의 settlement_sales_member_id / sales_member_id / 최근 이력 조회
 *
 * 정책
 *   - contracts.sales_member_id (원본) 는 절대 수정하지 않는다.
 *   - settlement_sales_member_id 만 갱신해, TY 동기화가 다음 번에도 sales_member_id 만 덮어쓴다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'contract id 필요' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { data: row, error } = await db
    .from('contracts')
    .select(
      [
        'id',
        'contract_code',
        'sales_member_id',
        'settlement_sales_member_id',
        'sales_member_override_reason',
        'sales_member_override_by',
        'sales_member_overridden_at',
      ].join(', '),
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'contract not found' }, { status: 404 });
  }

  const { data: history } = await db
    .from('contract_settlement_sales_member_history')
    .select('id, previous_settlement_sales_member_id, new_settlement_sales_member_id, previous_sales_member_id, reason, changed_by, changed_at')
    .eq('contract_id', id)
    .order('changed_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    contract: row,
    history: history ?? [],
  });
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'contract id 필요' }, { status: 400 });
  }

  let body: {
    settlement_sales_member_id?: string | null;
    reason?: string | null;
    changed_by?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  // null 이면 override 해제, 문자열이면 새 override member_id
  const rawNew = body.settlement_sales_member_id;
  let newOverride: string | null;
  if (rawNew === null || rawNew === undefined || rawNew === '') {
    newOverride = null;
  } else if (typeof rawNew === 'string') {
    newOverride = rawNew.trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(newOverride)) {
      return NextResponse.json(
        { error: 'settlement_sales_member_id 는 UUID 문자열이어야 합니다' },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      { error: 'settlement_sales_member_id 는 UUID 문자열 또는 null 이어야 합니다' },
      { status: 400 },
    );
  }

  const reason = (body.reason ?? '').toString().trim() || null;
  const changedBy = (body.changed_by ?? '').toString().trim() || 'admin';

  const db = createAdminSupabaseClient();

  const { data: current, error: cErr } = await db
    .from('contracts')
    .select('id, sales_member_id, settlement_sales_member_id')
    .eq('id', id)
    .maybeSingle();
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: 'contract not found' }, { status: 404 });
  }
  const cur = current as { id: string; sales_member_id: string | null; settlement_sales_member_id: string | null };

  // 새 override 가 실제 organization_members 에 존재하는지 확인 (NULL은 패스)
  if (newOverride) {
    const { data: m, error: mErr } = await db
      .from('organization_members')
      .select('id, is_active')
      .eq('id', newOverride)
      .maybeSingle();
    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 });
    }
    if (!m) {
      return NextResponse.json(
        { error: '존재하지 않는 organization_members id 입니다' },
        { status: 400 },
      );
    }
    if ((m as { is_active: boolean }).is_active === false) {
      return NextResponse.json(
        { error: '비활성 조직원으로는 정산 담당자 override 를 설정할 수 없습니다' },
        { status: 400 },
      );
    }
  }

  const nowIso = new Date().toISOString();
  const { error: uErr } = await db
    .from('contracts')
    .update({
      settlement_sales_member_id: newOverride,
      sales_member_override_reason: newOverride ? reason : null,
      sales_member_override_by: newOverride ? changedBy : null,
      sales_member_overridden_at: newOverride ? nowIso : null,
    })
    .eq('id', id);
  if (uErr) {
    return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  // 변경 이력 기록 (성공 후)
  try {
    await db.from('contract_settlement_sales_member_history').insert({
      contract_id: id,
      previous_settlement_sales_member_id: cur.settlement_sales_member_id,
      new_settlement_sales_member_id: newOverride,
      previous_sales_member_id: cur.sales_member_id,
      reason,
      changed_by: changedBy,
    });
  } catch (e) {
    // 이력 저장 실패는 본 작업 실패로 만들지 않는다(이미 contracts UPDATE 성공)
    // eslint-disable-next-line no-console
    console.warn('[settlement-sales-member] history insert failed', e);
  }

  return NextResponse.json({
    success: true,
    contract_id: id,
    settlement_sales_member_id: newOverride,
  });
}
