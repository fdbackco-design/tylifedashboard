/**
 * 담당자 변경 완료 시, 해당 고객과 동일 신원인 organization 노드를 새 담당자 산하로 옮긴다.
 *
 * 대상 (같은 customer_id 로 한정):
 * - `external_id = customer:{customerId}`  (순수 고객 노드)
 * - `external_id = cust:{customerId}`     (계정 발급 등으로 직원 전환된 노드, 예: 김태화)
 * - `source_customer_id = customerId`     (위와 동일 신원)
 *
 * 제외:
 * - 본사 / 안성준
 * - self-loop / cycle
 * - 이미 새 담당자 산하
 *
 * 실패해도 호출자(완료 처리)를 깨지 않도록 best-effort 로 동작한다.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ReparentOrgResult = {
  moved: number;
  alreadyUnderParent: number;
  skipped: number;
  reason?: string;
};

async function wouldCreateCycle(
  db: SupabaseClient,
  parentId: string,
  childId: string,
): Promise<boolean> {
  const visited = new Set<string>();
  let cur: string | null = parentId;
  while (cur) {
    if (cur === childId) return true;
    if (visited.has(cur)) break;
    visited.add(cur);
    const { data } = (await db
      .from('organization_edges')
      .select('parent_id')
      .eq('child_id', cur)
      .maybeSingle()) as { data: { parent_id: string | null } | null };
    cur = data?.parent_id ?? null;
  }
  return false;
}

function isSameCustomerIdentity(
  node: { external_id: string | null; source_customer_id?: string | null },
  customerId: string,
): boolean {
  const ext = String(node.external_id ?? '');
  if (ext === `customer:${customerId}` || ext === `cust:${customerId}`) return true;
  if (String(node.source_customer_id ?? '') === customerId) return true;
  return false;
}

/**
 * 완료된 담당자 변경 건의 고객(동일 신원) 노드를 newSalesMemberId 산하로 이동.
 */
export async function reparentCustomerOrgForManagerChange(
  db: SupabaseClient,
  args: {
    customerId: string;
    newSalesMemberId: string;
    sourceContractId?: string | null;
  },
): Promise<ReparentOrgResult> {
  const customerId = String(args.customerId ?? '').trim();
  const newParentId = String(args.newSalesMemberId ?? '').trim();
  if (!customerId || !newParentId) {
    return { moved: 0, alreadyUnderParent: 0, skipped: 0, reason: 'missing_ids' };
  }

  const customerExt = `customer:${customerId}`;
  const custExt = `cust:${customerId}`;

  // 동일 고객 신원 노드만 조회 (or 필터). 직원 전체 스캔 없음.
  const { data: nodes, error } = await db
    .from('organization_members')
    .select('id, name, rank, external_id, source_customer_id, is_active')
    .eq('is_active', true)
    .or(
      [
        `external_id.eq.${customerExt}`,
        `external_id.eq.${custExt}`,
        `source_customer_id.eq.${customerId}`,
      ].join(','),
    );
  if (error) {
    return { moved: 0, alreadyUnderParent: 0, skipped: 0, reason: error.message };
  }

  const list = (
    (nodes ?? []) as Array<{
      id: string;
      name: string | null;
      rank: string | null;
      external_id: string | null;
      source_customer_id: string | null;
    }>
  ).filter((n) => isSameCustomerIdentity(n, customerId));

  if (list.length === 0) {
    return { moved: 0, alreadyUnderParent: 0, skipped: 0, reason: 'no_customer_node' };
  }

  let moved = 0;
  let alreadyUnderParent = 0;
  let skipped = 0;

  for (const node of list) {
    const childId = String(node.id);
    if (node.rank === '본사' || String(node.name ?? '').replace(/^\[고객\]\s*/u, '').trim() === '안성준') {
      skipped++;
      continue;
    }
    if (childId === newParentId) {
      skipped++;
      continue;
    }

    const { data: edge } = await db
      .from('organization_edges')
      .select('id, parent_id, is_manual')
      .eq('child_id', childId)
      .maybeSingle();

    const currentParent = (edge as { parent_id: string | null } | null)?.parent_id ?? null;
    if (currentParent === newParentId) {
      alreadyUnderParent++;
      continue;
    }

    try {
      if (await wouldCreateCycle(db, newParentId, childId)) {
        skipped++;
        continue;
      }
    } catch {
      skipped++;
      continue;
    }

    const { data: upserted, error: upErr } = await db
      .from('organization_edges')
      .upsert(
        {
          child_id: childId,
          parent_id: newParentId,
          // 담당자 변경으로 맞춘 위치는 sync 가 다시 덮지 않도록 수동 마킹
          is_manual: true,
          manual_updated_at: new Date().toISOString(),
        } as any,
        { onConflict: 'child_id' },
      )
      .select('id')
      .maybeSingle();

    if (upErr || !upserted) {
      skipped++;
      continue;
    }

    const edgeId = (upserted as { id: string }).id;
    const sourceContractId = args.sourceContractId ? String(args.sourceContractId).trim() : '';
    if (sourceContractId) {
      await db.from('organization_edge_sources').upsert(
        {
          edge_id: edgeId,
          source_contract_id: sourceContractId,
          created_by: 'manager-change',
        },
        { onConflict: 'edge_id,source_contract_id' },
      );
    }

    moved++;
  }

  return { moved, alreadyUnderParent, skipped };
}
