import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

/**
 * POST /api/contracts/:id/link-contractor
 * body:
 * - contractor_member_id?: string | null
 * - action?: 'link' | 'not_internal'
 *
 * 동작:
 * - link: 계약의 contractor_member_id 확정 + contractor_link_status=linked
 * - not_internal: 일반 고객 계약으로 확정(편입 제외)
 *
 * linked인 경우:
 * - parent A = contracts.sales_member_id
 * - child  B = contractor_member_id
 * - organization_edges(A->B) 생성(이미 child parent가 있으면 건드리지 않음)
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const db = createAdminSupabaseClient();

  let body: {
    contractor_member_id?: string | null;
    action?: 'link' | 'not_internal';
  } = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  const action = body.action ?? 'link';

  const { data: contract, error: cErr } = await db
    .from('contracts')
    .select('id, sales_member_id')
    .eq('id', id)
    .single();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const salesMemberId = (contract as { sales_member_id: string | null }).sales_member_id;

  if (action === 'not_internal') {
    const { error: uErr } = await db
      .from('contracts')
      .update({
        contractor_member_id: null,
        contractor_link_status: 'not_internal',
        contractor_candidates_json: null,
      })
      .eq('id', id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const memberId = body.contractor_member_id ?? null;
  if (!memberId) {
    return NextResponse.json({ error: 'contractor_member_id is required' }, { status: 400 });
  }

  const { error: uErr } = await db
    .from('contracts')
    .update({
      contractor_member_id: memberId,
      contractor_link_status: 'linked',
      contractor_candidates_json: null,
    })
    .eq('id', id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  if (salesMemberId) {
    // child_id UNIQUE: 이미 parent가 있으면 건드리지 않음
    const { data: existing, error: exErr } = await db
      .from('organization_edges')
      .select('id, parent_id')
      .eq('child_id', memberId)
      .maybeSingle();
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

    if (!existing) {
      const { data: edge, error: insErr } = await db
        .from('organization_edges')
        .insert({ parent_id: salesMemberId, child_id: memberId })
        .select('id')
        .single();
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      const edgeId = (edge as { id: string }).id;
      await db.from('organization_edge_sources').upsert(
        { edge_id: edgeId, source_contract_id: id, created_by: 'admin' },
        { onConflict: 'edge_id,source_contract_id' },
      );
    } else {
      const edgeId = (existing as { id: string }).id;
      await db.from('organization_edge_sources').upsert(
        { edge_id: edgeId, source_contract_id: id, created_by: 'admin' },
        { onConflict: 'edge_id,source_contract_id' },
      );
    }
  }

  return NextResponse.json({ success: true });
}

