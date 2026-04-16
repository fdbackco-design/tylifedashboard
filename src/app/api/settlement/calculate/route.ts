/**
 * POST /api/settlement/calculate
 * 월별 정산 계산/재계산 (서버 전용)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { calculateMemberSettlement, buildOrgTree, findActiveRule } from '@/lib/settlement/calculator';
import type { Contract, OrganizationMember, SettlementRule, OrgTreeRow } from '@/lib/types';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // TODO: 인증 추가 필요 (현재 서버 내부 호출 가정)
  let body: { year_month?: string; force?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const { year_month, force = false } = body;

  if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
    return NextResponse.json(
      { error: 'year_month 필드가 필요합니다 (형식: YYYY-MM)' },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();

  // 확정된 정산 재계산 방지
  if (!force) {
    const { data: existing } = await db
      .from('monthly_settlements')
      .select('id, is_finalized')
      .eq('year_month', year_month)
      .eq('is_finalized', true)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `${year_month} 정산이 이미 확정되었습니다. force=true로 재계산하세요.` },
        { status: 409 },
      );
    }
  }

  try {
    const result = await calculateMonthlySettlement(year_month, db);
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/settlement/calculate] 정산 계산 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function calculateMonthlySettlement(
  yearMonth: string,
  db: ReturnType<typeof createAdminSupabaseClient>,
): Promise<{ updated_count: number }> {
  // 규칙 effective_from이 월 중간이어도 해당 월 정산에 적용되도록 말일 기준으로 매칭
  const [y, m] = yearMonth.split('-').map(Number);
  const end = new Date(y, m, 0);
  const refDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

  // 1. 정산 대상 계약 조회 (v_contract_settlement_base가 SSOT 기준으로 필터링)
  const { data: contracts, error: cErr } = await db
    .from('v_contract_settlement_base')
    .select('*')
    .eq('year_month', yearMonth);

  if (cErr) throw new Error(`계약 조회 실패: ${cErr.message}`);

  // 2. 정산 규칙 조회
  const { data: rules, error: rErr } = await db
    .from('settlement_rules')
    .select('*');

  if (rErr) throw new Error(`정산 규칙 조회 실패: ${rErr.message}`);

  // 3. 조직원 전체 + edges 조회
  const [membersRes, edgesRes] = await Promise.all([
    db.from('organization_members').select('id, name, rank').eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
  ]);

  if (membersRes.error) throw new Error(`조직원 조회 실패: ${membersRes.error.message}`);

  // 4. 멤버별 계약 맵 구성
  const contractsByMember = new Map<string, Contract[]>();
  for (const c of (contracts ?? []) as Contract[]) {
    if (!c.sales_member_id) continue;
    const arr = contractsByMember.get(c.sales_member_id) ?? [];
    arr.push(c);
    contractsByMember.set(c.sales_member_id, arr);
  }

  // 5. 조직 트리 빌드
  const edgeMap = new Map<string, string | null>();
  for (const e of edgesRes.data ?? []) {
    edgeMap.set(
      (e as { child_id: string }).child_id,
      (e as { parent_id: string | null }).parent_id,
    );
  }

  const treeRows: OrgTreeRow[] = (membersRes.data ?? []).map((m) => ({
    id: (m as OrganizationMember).id,
    name: (m as OrganizationMember).name,
    rank: (m as OrganizationMember).rank,
    parent_id: edgeMap.get((m as OrganizationMember).id) ?? null,
    depth: 0,
  }));

  const trees = buildOrgTree(treeRows);
  const nodeById = new Map<string, ReturnType<typeof buildOrgTree>[number]>();
  (function indexNodes(nodes: ReturnType<typeof buildOrgTree>) {
    for (const n of nodes) {
      nodeById.set(n.id, n);
      indexNodes(n.children);
    }
  })(trees);

  // 6. 각 멤버 정산 계산 및 upsert
  let updatedCount = 0;

  for (const member of (membersRes.data ?? []) as OrganizationMember[]) {
    const rule = findActiveRule(rules as SettlementRule[], member.rank, refDate);
    if (!rule) continue;

    const orgNode = nodeById.get(member.id) ?? null;
    if (!orgNode) continue;

    const settlement = calculateMemberSettlement(
      { id: member.id, name: member.name, rank: member.rank },
      contractsByMember.get(member.id) ?? [],
      orgNode,
      contractsByMember,
      rules as SettlementRule[],
      yearMonth,
    );

    const { error: uErr } = await db
      .from('monthly_settlements')
      .upsert(settlement, { onConflict: 'year_month,member_id' });

    if (uErr) {
      console.error(`[settlement] ${member.name} 정산 저장 실패:`, uErr.message);
    } else {
      updatedCount++;
    }
  }

  return { updated_count: updatedCount };
}

