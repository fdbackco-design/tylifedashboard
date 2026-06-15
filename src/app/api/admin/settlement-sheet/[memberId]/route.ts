/**
 * 관리자 명세서 보정값 R/W API.
 *
 *  PUT    /api/admin/settlement-sheet/[memberId]
 *           body: { year_month, personal_unit_count, downline_unit_count,
 *                   personal_commission, override_amount, bonus_amount, memo }
 *           모든 필드는 nullable (null = 자동 계산값 사용).
 *           settlement_statement_overrides 에 upsert (year_month, member_id) UNIQUE.
 *
 *  DELETE /api/admin/settlement-sheet/[memberId]
 *           body: { year_month }
 *           해당 (year_month, member_id) 의 override 행을 삭제.
 *
 * 정산 계산 로직(monthly_settlements 생성 등)은 이 API 에서 절대 변경하지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { normalizeYearMonthLabel } from '@/lib/settlement/settlement-window';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function asNullableInt(v: unknown, name: string): { ok: true; value: number | null } | { ok: false; error: string } {
  if (v == null) return { ok: true, value: null };
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) {
    return { ok: true, value: v };
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return { ok: true, value: null };
    if (!/^-?\d+$/.test(t)) return { ok: false, error: `${name} 는 정수여야 합니다` };
    const n = parseInt(t, 10);
    if (!Number.isFinite(n)) return { ok: false, error: `${name} 는 정수여야 합니다` };
    return { ok: true, value: n };
  }
  return { ok: false, error: `${name} 형식이 올바르지 않습니다` };
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ memberId: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { memberId } = await ctx.params;
  if (!UUID.test(memberId)) return NextResponse.json({ error: 'invalid_member_id' }, { status: 400 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const yearMonth = normalizeYearMonthLabel(String(body.year_month ?? ''));
  if (!yearMonth) return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 });

  const fields = {
    personal_unit_count: asNullableInt(body.personal_unit_count, 'personal_unit_count'),
    downline_unit_count: asNullableInt(body.downline_unit_count, 'downline_unit_count'),
    personal_commission: asNullableInt(body.personal_commission, 'personal_commission'),
    override_amount: asNullableInt(body.override_amount, 'override_amount'),
    bonus_amount: asNullableInt(body.bonus_amount, 'bonus_amount'),
  } as const;
  for (const k of Object.keys(fields) as Array<keyof typeof fields>) {
    if (!fields[k].ok) return NextResponse.json({ error: fields[k].error }, { status: 400 });
  }
  const memo = typeof body.memo === 'string' ? body.memo.trim() || null : null;

  const db = createAdminSupabaseClient();

  // member 존재 확인
  const { data: member, error: memberErr } = await db
    .from('organization_members')
    .select('id')
    .eq('id', memberId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (!member) return NextResponse.json({ error: 'member_not_found' }, { status: 404 });

  const { error } = await db.from('settlement_statement_overrides').upsert(
    {
      year_month: yearMonth,
      member_id: memberId,
      personal_unit_count: (fields.personal_unit_count as { value: number | null }).value,
      downline_unit_count: (fields.downline_unit_count as { value: number | null }).value,
      personal_commission: (fields.personal_commission as { value: number | null }).value,
      override_amount: (fields.override_amount as { value: number | null }).value,
      bonus_amount: (fields.bonus_amount as { value: number | null }).value,
      memo,
    },
    { onConflict: 'year_month,member_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ memberId: string }> },
): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { memberId } = await ctx.params;
  if (!UUID.test(memberId)) return NextResponse.json({ error: 'invalid_member_id' }, { status: 400 });

  let body: { year_month?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const yearMonth = normalizeYearMonthLabel(String(body.year_month ?? ''));
  if (!yearMonth) return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 });

  const db = createAdminSupabaseClient();
  const { error } = await db
    .from('settlement_statement_overrides')
    .delete()
    .eq('year_month', yearMonth)
    .eq('member_id', memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
