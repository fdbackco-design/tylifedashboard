/**
 * TY 동기화 시점에 "접수완료(RECEIVED)" 상태의 담당자 변경 신청이
 * 실제 계약 담당자 변경으로 반영되었는지 확인하고,
 * 반영된 경우 자동으로 COMPLETED 처리 + 영업자 푸시 알림 + 고객 조직 노드 재배치를 한다.
 *
 * 완료 판정(하나라도 일치하면 COMPLETED):
 * 1) 신청의 contract_id 또는 contract_codes 그룹 중 아무 계약이라도
 * 2) TY 원본 담당자(source_snapshot_json.담당자) 또는 sales_member 이름이
 * 3) after_manager_name(슬래시 앞)과 정규화 후 일치
 *
 * 조직 재배치(최소 범위):
 * - sales_member_id 이름이 after_manager 와 일치할 때만
 * - 해당 customer 와 동일 신원 노드만 이동
 *   (`customer:{id}` / `cust:{id}` / source_customer_id)
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyRequesterOfManagerChangeCompleted } from '@/lib/manager-change/notify';
import { reparentCustomerOrgForManagerChange } from '@/lib/manager-change/reparent-org';

function normalizeName(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/^\[고객\]\s*/u, '')
    .replace(/\s+/g, '')
    .trim();
}

function afterManagerNameOnly(raw: string | null | undefined): string {
  // "이름 / 전화" 형태로 들어간 경우 슬래시 앞만 사용
  return normalizeName(String(raw ?? '').split('/')[0] ?? '');
}

function parseContractCodes(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

function snapshotManagerName(sourceSnapshot: unknown): string {
  let snap: Record<string, unknown> | null = null;
  if (typeof sourceSnapshot === 'string') {
    try {
      const parsed = JSON.parse(sourceSnapshot);
      if (parsed && typeof parsed === 'object') snap = parsed as Record<string, unknown>;
    } catch {
      return '';
    }
  } else if (sourceSnapshot && typeof sourceSnapshot === 'object') {
    snap = sourceSnapshot as Record<string, unknown>;
  }
  if (!snap) return '';
  return normalizeName((snap['담당자'] ?? snap['담당 사원'] ?? null) as string | null);
}

export async function autoCompleteReceivedManagerChangeRequests(
  db: SupabaseClient,
): Promise<{ scanned: number; completed: number; notified: number; skipped: number; org_moved: number }> {
  const { data: rows, error } = await db
    .from('manager_change_requests')
    .select('id, contract_id, customer_id, contract_codes, after_manager_name, status')
    .eq('status', 'RECEIVED')
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);

  const list = (rows ?? []) as Array<{
    id: string;
    contract_id: string | null;
    customer_id: string | null;
    contract_codes: string | null;
    after_manager_name: string | null;
    status: string | null;
  }>;

  let completed = 0;
  let notified = 0;
  let skipped = 0;
  let orgMoved = 0;
  const now = new Date().toISOString();

  for (const r of list) {
    const requestId = String(r.id ?? '').trim();
    if (!requestId) {
      skipped++;
      continue;
    }

    const afterName = afterManagerNameOnly(r.after_manager_name);
    if (!afterName) {
      skipped++;
      continue;
    }

    const contractCodes = parseContractCodes(r.contract_codes);
    const contractId = String(r.contract_id ?? '').trim();

    // 신청에 묶인 계약 전체를 후보로 본다 (대표 contract_id + codes)
    let contractRows: Array<{
      id: string;
      sales_member_id: string | null;
      source_snapshot_json: unknown;
    }> = [];

    if (contractCodes.length > 0) {
      const { data, error: cErr } = await db
        .from('contracts')
        .select('id, sales_member_id, source_snapshot_json')
        .in('contract_code', contractCodes);
      if (cErr) {
        skipped++;
        continue;
      }
      contractRows = (data ?? []) as typeof contractRows;
    }

    if (contractId) {
      const already = contractRows.some((c) => c.id === contractId);
      if (!already) {
        const { data: cRow, error: cErr } = await db
          .from('contracts')
          .select('id, sales_member_id, source_snapshot_json')
          .eq('id', contractId)
          .maybeSingle();
        if (!cErr && cRow) {
          contractRows.push(cRow as (typeof contractRows)[number]);
        }
      }
    }

    if (contractRows.length === 0) {
      skipped++;
      continue;
    }

    const salesMemberIds = [
      ...new Set(
        contractRows
          .map((c) => String(c.sales_member_id ?? '').trim())
          .filter(Boolean),
      ),
    ];

    const nameByMemberId = new Map<string, string>();
    if (salesMemberIds.length > 0) {
      const { data: members, error: mErr } = await db
        .from('organization_members')
        .select('id, name')
        .in('id', salesMemberIds);
      if (mErr) {
        skipped++;
        continue;
      }
      for (const m of (members ?? []) as Array<{ id: string; name: string | null }>) {
        nameByMemberId.set(String(m.id), normalizeName(m.name));
      }
    }

    const matchedByMember = contractRows.filter((c) => {
      const mid = String(c.sales_member_id ?? '').trim();
      if (!mid) return false;
      const memberName = nameByMemberId.get(mid) ?? '';
      return memberName !== '' && memberName === afterName;
    });
    const matchedBySnapshot = contractRows.some((c) => {
      const snapName = snapshotManagerName(c.source_snapshot_json);
      return Boolean(snapName && snapName === afterName);
    });

    // 완료 판정: 스냅샷 또는 sales_member 이름 일치
    if (matchedByMember.length === 0 && !matchedBySnapshot) {
      skipped++;
      continue;
    }

    const { error: upErr } = await db
      .from('manager_change_requests')
      .update({ status: 'COMPLETED', completed_at: now })
      .eq('id', requestId)
      .eq('status', 'RECEIVED');
    if (upErr) {
      skipped++;
      continue;
    }

    completed++;

    // 조직도: sales_member_id 가 after_manager 와 일치할 때만 고객 노드 이동
    // (스냅샷만 맞고 담당자 id 가 아직 옛값이면 잘못된 산하 이동을 막음)
    const newSalesMemberId = String(matchedByMember[0]?.sales_member_id ?? '').trim();
    const customerId = String(r.customer_id ?? '').trim();
    if (newSalesMemberId && customerId) {
      try {
        const orgRes = await reparentCustomerOrgForManagerChange(db, {
          customerId,
          newSalesMemberId,
          sourceContractId: matchedByMember[0]?.id ?? r.contract_id,
        });
        orgMoved += orgRes.moved;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[manager-change-auto-complete] org reparent failed', requestId, e);
      }
    }

    try {
      const res = await notifyRequesterOfManagerChangeCompleted(db, requestId);
      if (!('skipped' in res)) notified += res.sent;
    } catch {
      // 알림 실패는 동기화 실패로 처리하지 않는다.
    }
  }

  return { scanned: list.length, completed, notified, skipped, org_moved: orgMoved };
}
