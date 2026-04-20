/**
 * POST /api/settlement/calculate
 * 월별 정산 계산/재계산 (서버 전용)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  calculateMemberSettlement,
  buildOrgTree,
  type LeaderSettlementOpts,
} from '@/lib/settlement/calculator';
import { getSettlementWindowForYearMonth } from '@/lib/settlement/settlement-window';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  computeSalesMemberPromotionThreshold,
  type AttributedJoinContractRow,
} from '@/lib/settlement/leader-promotion';
import type { Contract, OrganizationMember, SettlementRule } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';

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
  const { end_date } = getSettlementWindowForYearMonth(yearMonth);

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

  // 3. 조직원 전체 + edges 조회 (/settlement 페이지와 동일 트리)
  const [membersRes, edgesRes, joinContractsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, external_id, phone, source_customer_id')
      .eq('is_active', true),
    db.from('organization_edges').select('parent_id, child_id'),
    db
      .from('contracts')
      .select('id, join_date, unit_count, sales_member_id, customer_id, sales_link_status, status, is_cancelled')
      .eq('status', '가입')
      .eq('is_cancelled', false),
  ]);

  if (membersRes.error) throw new Error(`조직원 조회 실패: ${membersRes.error.message}`);
  if (joinContractsRes.error) throw new Error(`가입 계약 조회 실패: ${joinContractsRes.error.message}`);

  const membersRaw = ((membersRes.data ?? []) as unknown as OrganizationMember[]).map((m) =>
    m.name === '안성준' ? { ...m, rank: '본사' as const } : m,
  );
  const edgesRaw = (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>;

  const hqIdsRaw = new Set(
    membersRaw.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id as string),
  );

  const memberIdByCustomerId = new Map<string, string>();
  for (const m of membersRaw as any[]) {
    const sid = (m.source_customer_id ?? null) as string | null;
    if (sid && m.rank !== '본사') {
      memberIdByCustomerId.set(sid, m.id as string);
      continue;
    }
    const ext = (m.external_id ?? null) as string | null;
    if (ext && ext.startsWith('customer:') && m.rank !== '본사') {
      const customerId = ext.slice('customer:'.length);
      if (!memberIdByCustomerId.has(customerId)) memberIdByCustomerId.set(customerId, m.id as string);
    }
  }

  const joinAttributed: AttributedJoinContractRow[] = [];
  for (const row of (joinContractsRes.data ?? []) as any[]) {
    if ((row.sales_link_status ?? 'linked') !== 'linked') continue;
    if (!row.sales_member_id) continue;
    let sid = row.sales_member_id as string;
    const cid = row.customer_id as string | null;
    if (cid) {
      const mapped = memberIdByCustomerId.get(cid);
      if (mapped) sid = mapped;
    }
    joinAttributed.push({
      id: row.id,
      join_date: String(row.join_date ?? '').slice(0, 10),
      unit_count: row.unit_count ?? 0,
      sales_member_id: sid,
    });
  }

  const treeRows = buildSettlementTreeRows(
    membersRaw as Array<{ id: string; name: string; rank: RankType; source_customer_id?: string | null }>,
    edgesRaw,
  );

  // 승격 threshold 계산은 DB rank 변화에 영향받지 않아야 한다.
  // (재계산 버튼을 여러 번 눌러도 동일 결과가 나오도록)
  // 따라서 '리더'도 임시로 '영업사원'으로 취급해 threshold를 다시 계산한다.
  // (기존 DB 리더도 threshold가 계산될 수 있지만, 정산 계산에서의 적용 여부는 calculator에서 분기한다.)
  const rankById = new Map<string, RankType>();
  for (const m of membersRaw) {
    const r = m.rank as RankType;
    rankById.set(m.id as string, r === '리더' ? '영업사원' : r);
  }

  const promotionThresholdByMemberId = computeSalesMemberPromotionThreshold(
    treeRows,
    joinAttributed,
    rankById,
  );

  const leaderOpts: LeaderSettlementOpts = {
    treeRows,
    promotionThresholdByMemberId,
    joinOnlyAttributed: joinAttributed,
    settlementEndDate: end_date,
  };

  // 4. 멤버별 계약 맵 구성
  const contractsByMember = new Map<string, Contract[]>();
  for (const c of (contracts ?? []) as Contract[]) {
    if (!c.sales_member_id) continue;
    const arr = contractsByMember.get(c.sales_member_id) ?? [];
    arr.push(c);
    contractsByMember.set(c.sales_member_id, arr);
  }

  // 5. 조직 트리 빌드
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

  for (const member of membersRaw as OrganizationMember[]) {
    const orgNode = nodeById.get(member.id) ?? null;
    if (!orgNode) continue;

    const settlement = calculateMemberSettlement(
      { id: member.id, name: member.name, rank: member.rank },
      contractsByMember.get(member.id) ?? [],
      orgNode,
      contractsByMember,
      rules as SettlementRule[],
      yearMonth,
      leaderOpts,
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

  // 승격 반영(조직도/프로필 표시용): 정산 계산은 "영업사원 + 승격 계약 기준"으로 수행한 뒤,
  // DB rank를 리더로 올려 화면/조직도에서도 일관되게 보이도록 한다.
  {
    const toPromote: string[] = [];
    for (const m of membersRaw) {
      if ((m.rank as RankType) !== '영업사원') continue;
      const th = promotionThresholdByMemberId.get(m.id as string) ?? null;
      if (th) toPromote.push(m.id as string);
    }
    if (toPromote.length > 0) {
      const { error: upErr } = await db
        .from('organization_members')
        .update({ rank: '리더' })
        .in('id', toPromote)
        .eq('rank', '영업사원'); // 안전장치: 상위직급 덮어쓰기 방지
      if (upErr) throw new Error(`승격 반영 실패: ${upErr.message}`);
    }
  }

  return { updated_count: updatedCount };
}

