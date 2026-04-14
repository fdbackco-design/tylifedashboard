/**
 * POST /api/contracts/[id]/link-sales
 * body: { member_id: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { buildPerformancePath } from '@/lib/organization/performance-path';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: contractId } = await ctx.params;

  let body: { member_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const memberId = body.member_id;
  if (!memberId || typeof memberId !== 'string') {
    return NextResponse.json({ error: 'member_id가 필요합니다' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();

  const { data: contract, error: cErr } = await db
    .from('contracts')
    .select('id, sales_link_status')
    .eq('id', contractId)
    .maybeSingle();

  if (cErr || !contract) {
    return NextResponse.json({ error: cErr?.message ?? '계약 없음' }, { status: 404 });
  }

  if ((contract as { sales_link_status: string }).sales_link_status !== 'pending_mapping') {
    return NextResponse.json({ error: '이 계약은 매핑 대기 상태가 아닙니다' }, { status: 409 });
  }

  const { data: member, error: mErr } = await db
    .from('organization_members')
    .select('id')
    .eq('id', memberId)
    .maybeSingle();

  if (mErr || !member) {
    return NextResponse.json({ error: '조직원을 찾을 수 없습니다' }, { status: 400 });
  }

  try {
    const path = await buildPerformancePath(db, memberId);
    const { error: uErr } = await db
      .from('contracts')
      .update({
        sales_member_id: memberId,
        sales_link_status: 'linked',
        raw_sales_member_name: null,
        performance_path_json: path,
      })
      .eq('id', contractId)
      .eq('sales_link_status', 'pending_mapping');

    if (uErr) {
      return NextResponse.json({ error: uErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
