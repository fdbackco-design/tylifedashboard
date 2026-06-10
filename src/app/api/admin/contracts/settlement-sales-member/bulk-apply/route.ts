/**
 * POST /api/admin/contracts/settlement-sales-member/bulk-apply
 *
 * 조직도 기준 정산 담당자 자동 보정 — 선택된 계약만 일괄 적용.
 *
 * body: {
 *   items: Array<{ contract_id: string; settlement_sales_member_id: string }>,
 *   reason?: string,
 *   changed_by?: string,
 * }
 *
 * - contracts.sales_member_id 는 절대 수정하지 않는다.
 * - settlement_sales_member_id / sales_member_override_reason / _by / _at 만 업데이트.
 * - contract_settlement_sales_member_history 에 변경 이력 row INSERT.
 * - 안전 가드: 본 라우트는 organization_members 가 활성·존재하는지 한 번 더 확인한다.
 * - 자동/수동 모두 동일하게 이력에는 reason="조직도 수동 수정 기준 정산 담당자 자동 보정" 등 사용자가 보낸 값 사용.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: {
    items?: Array<{ contract_id?: string; settlement_sales_member_id?: string }>;
    reason?: string | null;
    changed_by?: string | null;
  } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON body 필요' }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'items 가 비어있습니다' }, { status: 400 });
  }
  if (items.length > 2000) {
    return NextResponse.json({ error: 'items 는 한 번에 최대 2000건' }, { status: 400 });
  }

  type Item = { contract_id: string; settlement_sales_member_id: string };
  const validItems: Item[] = [];
  for (const it of items) {
    const cid = (it.contract_id ?? '').toString().trim();
    const mid = (it.settlement_sales_member_id ?? '').toString().trim();
    if (!UUID.test(cid) || !UUID.test(mid)) continue;
    validItems.push({ contract_id: cid, settlement_sales_member_id: mid });
  }
  if (validItems.length === 0) {
    return NextResponse.json({ error: '유효한 항목이 없습니다' }, { status: 400 });
  }

  const reason =
    (body.reason ?? '').toString().trim() || '조직도 수동 수정 기준 정산 담당자 자동 보정';
  const changedBy = (body.changed_by ?? '').toString().trim() || 'admin';

  const db = createAdminSupabaseClient();

  // 입력 검증 1: 대상 organization_members 가 모두 활성/존재하는지
  const memberIds = [...new Set(validItems.map((i) => i.settlement_sales_member_id))];
  const { data: members, error: mErr } = await db
    .from('organization_members')
    .select('id, is_active')
    .in('id', memberIds);
  if (mErr) {
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }
  const activeMemberIds = new Set(
    ((members ?? []) as any[]).filter((m) => m.is_active !== false).map((m) => m.id as string),
  );

  // 입력 검증 2: 현재 contracts 상태 조회 (이력 기록용 + 존재 확인)
  const contractIds = validItems.map((i) => i.contract_id);
  const { data: contracts, error: cErr } = await db
    .from('contracts')
    .select('id, sales_member_id, settlement_sales_member_id, is_cancelled')
    .in('id', contractIds);
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  const contractById = new Map<
    string,
    { id: string; sales_member_id: string | null; settlement_sales_member_id: string | null; is_cancelled: boolean | null }
  >();
  for (const c of (contracts ?? []) as any[]) {
    contractById.set(c.id, {
      id: c.id,
      sales_member_id: c.sales_member_id ?? null,
      settlement_sales_member_id: c.settlement_sales_member_id ?? null,
      is_cancelled: (c.is_cancelled ?? null) as boolean | null,
    });
  }

  const results: Array<{
    contract_id: string;
    success: boolean;
    error?: string;
    previous_settlement_sales_member_id?: string | null;
    new_settlement_sales_member_id?: string;
  }> = [];

  const nowIso = new Date().toISOString();
  const historyRows: Array<{
    contract_id: string;
    previous_settlement_sales_member_id: string | null;
    new_settlement_sales_member_id: string;
    previous_sales_member_id: string | null;
    reason: string;
    changed_by: string;
  }> = [];

  for (const it of validItems) {
    const cur = contractById.get(it.contract_id);
    if (!cur) {
      results.push({ contract_id: it.contract_id, success: false, error: 'contract not found' });
      continue;
    }
    if (cur.is_cancelled === true) {
      results.push({ contract_id: it.contract_id, success: false, error: 'cancelled contract' });
      continue;
    }
    if (!activeMemberIds.has(it.settlement_sales_member_id)) {
      results.push({
        contract_id: it.contract_id,
        success: false,
        error: '비활성 또는 존재하지 않는 정산 담당자',
      });
      continue;
    }

    const { error: uErr } = await db
      .from('contracts')
      .update({
        settlement_sales_member_id: it.settlement_sales_member_id,
        sales_member_override_reason: reason,
        sales_member_override_by: changedBy,
        sales_member_overridden_at: nowIso,
      })
      .eq('id', it.contract_id);

    if (uErr) {
      results.push({ contract_id: it.contract_id, success: false, error: uErr.message });
      continue;
    }

    results.push({
      contract_id: it.contract_id,
      success: true,
      previous_settlement_sales_member_id: cur.settlement_sales_member_id,
      new_settlement_sales_member_id: it.settlement_sales_member_id,
    });

    historyRows.push({
      contract_id: it.contract_id,
      previous_settlement_sales_member_id: cur.settlement_sales_member_id,
      new_settlement_sales_member_id: it.settlement_sales_member_id,
      previous_sales_member_id: cur.sales_member_id,
      reason,
      changed_by: changedBy,
    });
  }

  // 이력 batch insert
  if (historyRows.length > 0) {
    try {
      await db.from('contract_settlement_sales_member_history').insert(historyRows);
    } catch (e) {
      // 본 작업은 이미 성공했으므로 이력 실패는 경고만 남긴다.
      // eslint-disable-next-line no-console
      console.warn('[bulk-apply] history insert failed', e);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  return NextResponse.json({
    success_count: successCount,
    fail_count: results.length - successCount,
    results,
  });
}
