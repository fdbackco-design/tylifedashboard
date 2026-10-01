/**
 * 정산현황의 영업자별 케어플랜 수당 보정.
 * null은 자동 원장 합계 사용, 0 이상 정수는 해당 금액으로 수동 대체한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { normalizeYearMonthLabel } from '@/lib/settlement/settlement-window';
import { patchMonthlySettlementTotalForCarePlan } from '@/lib/settlement/patch-care-plan-total';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function parseNullableAmount(value: unknown): number | null | undefined {
  if (value == null || value === '') return null;
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;
  if (!Number.isInteger(amount) || amount < 0) return undefined;
  return amount;
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const yearMonth = normalizeYearMonthLabel(String(body.year_month ?? ''));
  const memberId = String(body.member_id ?? '').trim();
  const overrideAmount = parseNullableAmount(body.care_plan_commission);
  if (!yearMonth) return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 });
  if (!UUID.test(memberId)) return NextResponse.json({ error: 'invalid_member_id' }, { status: 400 });
  if (overrideAmount === undefined) {
    return NextResponse.json(
      { error: 'care_plan_commission은 0 이상 정수 또는 null이어야 합니다.' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();
  const [{ data: settlement, error: settlementErr }, { data: previous, error: previousErr }] =
    await Promise.all([
      db
        .from('monthly_settlements')
        .select('id')
        .eq('year_month', yearMonth)
        .eq('member_id', memberId)
        .maybeSingle(),
      db
        .from('settlement_statement_overrides')
        .select('id, care_plan_commission')
        .eq('year_month', yearMonth)
        .eq('member_id', memberId)
        .maybeSingle(),
    ]);
  if (settlementErr) return NextResponse.json({ error: settlementErr.message }, { status: 500 });
  if (previousErr) return NextResponse.json({ error: previousErr.message }, { status: 500 });
  if (!settlement) return NextResponse.json({ error: 'settlement_not_found' }, { status: 404 });

  const previousOverride =
    previous?.care_plan_commission == null
      ? null
      : Math.max(0, Number(previous.care_plan_commission) || 0);

  const { error: overrideErr } = await db.from('settlement_statement_overrides').upsert(
    {
      year_month: yearMonth,
      member_id: memberId,
      care_plan_commission: overrideAmount,
    },
    { onConflict: 'year_month,member_id' },
  );
  if (overrideErr) return NextResponse.json({ error: overrideErr.message }, { status: 500 });

  const patched = await patchMonthlySettlementTotalForCarePlan(
    db,
    memberId,
    yearMonth,
    previousOverride,
    overrideAmount,
  );
  if (!patched.ok) return NextResponse.json({ error: patched.error }, { status: 500 });

  const { data: updated } = await db
    .from('monthly_settlements')
    .select('care_plan_commission')
    .eq('id', settlement.id)
    .single();
  const nextEffective = Math.max(0, Number(updated?.care_plan_commission ?? 0) || 0);

  return NextResponse.json({
    ok: true,
    care_plan_commission: nextEffective,
    override_amount: overrideAmount,
    total_amount: patched.total_amount,
  });
}
