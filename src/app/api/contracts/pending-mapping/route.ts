/**
 * GET /api/contracts/pending-mapping
 * 담당자 미확인(동명이인·미매칭) 계약 목록 + 동명 후보
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
      raw_sales_member_name,
      customers(name)
      `,
    )
    .eq('sales_link_status', 'pending_mapping')
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
    .limit(2000);

  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  const memberList = (allMembers ?? []) as { id: string; name: string; rank: string }[];

  const rows = (contracts ?? []).map((c) => {
    const raw = (c as { raw_sales_member_name: string | null }).raw_sales_member_name?.trim() ?? '';
    const candidates = raw ? memberList.filter((m) => m.name === raw) : [];
    return {
      ...c,
      name_candidates_same_name: candidates,
      /** 동명 후보가 없을 때(조직도에 이름 없음): 전체에서 한 명 선택 */
      all_members_fallback: candidates.length === 0 ? memberList : [],
    };
  });

  return NextResponse.json({ data: rows });
}
