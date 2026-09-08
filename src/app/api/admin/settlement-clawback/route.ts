/**
 * 정산 현황에서 영업자별 수동 환수금만 저장.
 *
 * PUT /api/admin/settlement-clawback
 *   body: { year_month, member_id, clawback_amount }
 *   clawback_amount: 0 이상 정수 (합계에서 차감할 금액)
 *
 * settlement_statement_overrides.clawback_amount 만 갱신하고,
 * 해당 월 monthly_settlements.total_amount 를 환수 차액만큼 즉시 보정한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { normalizeYearMonthLabel } from '@/lib/settlement/settlement-window';
import { resolveClawbackWon } from '@/lib/settlement/manual-adjustment';
import { patchMonthlySettlementTotalForClawback } from '@/lib/settlement/patch-clawback-total';
import { CLAWBACK_MIGRATION_ERROR, isMissingClawbackColumnError } from '@/lib/settlement/fetch-clawbacks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const yearMonth = normalizeYearMonthLabel(String(body.year_month ?? ''));
  if (!yearMonth) return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 });

  const memberId = String(body.member_id ?? '').trim();
  if (!UUID.test(memberId)) return NextResponse.json({ error: 'invalid_member_id' }, { status: 400 });

  const raw = body.clawback_amount;
  let clawbackAmount = 0;
  if (raw == null || raw === '') {
    clawbackAmount = 0;
  } else if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw)) {
    clawbackAmount = raw;
  } else if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) {
    clawbackAmount = parseInt(raw.trim(), 10);
  } else {
    return NextResponse.json({ error: 'clawback_amount 는 정수여야 합니다' }, { status: 400 });
  }
  if (clawbackAmount < 0) {
    return NextResponse.json({ error: 'clawback_amount 는 0 이상이어야 합니다' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  const { data: member, error: memberErr } = await db
    .from('organization_members')
    .select('id')
    .eq('id', memberId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (!member) return NextResponse.json({ error: 'member_not_found' }, { status: 404 });

  const { data: existing, error: existingErr } = await db
    .from('settlement_statement_overrides')
    .select('id, clawback_amount')
    .eq('year_month', yearMonth)
    .eq('member_id', memberId)
    .maybeSingle();
  if (existingErr) {
    if (isMissingClawbackColumnError(existingErr.message)) {
      return NextResponse.json({ error: CLAWBACK_MIGRATION_ERROR }, { status: 503 });
    }
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  const prevDb =
    existing && existing.clawback_amount != null ? Number(existing.clawback_amount) : null;

  if (existing?.id) {
    const { error } = await db
      .from('settlement_statement_overrides')
      .update({ clawback_amount: clawbackAmount })
      .eq('id', existing.id);
    if (error) {
      if (isMissingClawbackColumnError(error.message)) {
        return NextResponse.json({ error: CLAWBACK_MIGRATION_ERROR }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await db.from('settlement_statement_overrides').insert({
      year_month: yearMonth,
      member_id: memberId,
      clawback_amount: clawbackAmount,
    });
    if (error) {
      if (isMissingClawbackColumnError(error.message)) {
        return NextResponse.json({ error: CLAWBACK_MIGRATION_ERROR }, { status: 503 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const patched = await patchMonthlySettlementTotalForClawback(
    db,
    memberId,
    yearMonth,
    prevDb,
    clawbackAmount,
  );
  if (!patched.ok) return NextResponse.json({ error: patched.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    clawback_amount: resolveClawbackWon(memberId, yearMonth, clawbackAmount),
    total_amount: patched.total_amount,
  });
}
