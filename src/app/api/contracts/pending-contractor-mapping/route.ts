/**
 * GET /api/contracts/pending-contractor-mapping
 * 편입 대상(계약자=내부 영업사원) 매핑 대기 계약 목록 + 동명 후보
 */

import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(): Promise<NextResponse> {
  const db = createAdminSupabaseClient();

  const { data: contracts, error: cErr } = await db
    .from('contracts')
    .select(
      `
      id,
      contract_code,
      join_date,
      status,
      unit_count,
      contractor_name,
      sales_member_id,
      organization_members(name, rank),
      customers(name)
      `,
    )
    .eq('contractor_link_status', 'pending_mapping')
    .order('created_at', { ascending: false })
    .limit(200);

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  const { data: allMembers, error: mErr } = await db
    .from('organization_members')
    .select('id, name, rank')
    .eq('is_active', true)
    .order('name')
    .limit(5000);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const memberList = (allMembers ?? []) as { id: string; name: string; rank: string }[];

  const rows = (contracts ?? []).map((c) => {
    const raw = (c as { contractor_name: string | null }).contractor_name?.trim() ?? '';
    const candidates = raw ? memberList.filter((m) => m.name === raw) : [];
    return {
      ...c,
      name_candidates_same_name: candidates,
      all_members_fallback: candidates.length === 0 ? memberList : [],
    };
  });

  return NextResponse.json({ data: rows });
}

