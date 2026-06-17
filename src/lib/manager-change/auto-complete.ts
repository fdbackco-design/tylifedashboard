/**
 * TY 동기화 시점에 "접수완료(RECEIVED)" 상태의 담당자 변경 신청이
 * 실제 계약 담당자 변경(contracts.sales_member_id)으로 반영되었는지 확인하고,
 * 반영된 경우 자동으로 COMPLETED 처리 + 영업자 푸시 알림을 보낸다.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyRequesterOfManagerChangeCompleted } from '@/lib/manager-change/notify';

function normalizeName(s: string | null | undefined): string {
  return String(s ?? '').replace(/^\[고객\]\s*/, '').trim();
}

export async function autoCompleteReceivedManagerChangeRequests(
  db: SupabaseClient,
): Promise<{ scanned: number; completed: number; notified: number; skipped: number }> {
  const { data: rows, error } = await db
    .from('manager_change_requests')
    .select('id, contract_id, after_manager_name, status')
    .eq('status', 'RECEIVED')
    .limit(500);
  if (error) throw new Error(error.message);

  const list = (rows ?? []) as Array<{
    id: string;
    contract_id: string | null;
    after_manager_name: string | null;
    status: string | null;
  }>;

  let completed = 0;
  let notified = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const r of list) {
    const requestId = String(r.id ?? '').trim();
    const contractId = String(r.contract_id ?? '').trim();
    if (!requestId || !contractId) {
      skipped++;
      continue;
    }

    const afterName = normalizeName(r.after_manager_name);

    const { data: cRow, error: cErr } = await db
      .from('contracts')
      .select('id, sales_member_id')
      .eq('id', contractId)
      .maybeSingle();
    if (cErr || !cRow) {
      skipped++;
      continue;
    }

    const salesMemberId = String((cRow as any)?.sales_member_id ?? '').trim();
    if (!salesMemberId) {
      skipped++;
      continue;
    }

    const { data: mRow, error: mErr } = await db
      .from('organization_members')
      .select('name, phone')
      .eq('id', salesMemberId)
      .maybeSingle();
    if (mErr || !mRow) {
      skipped++;
      continue;
    }

    const currentName = normalizeName((mRow as any)?.name ?? null);

    // 확인 규칙:
    // - 계약의 현재 담당자명이 신청서의 변경 후 담당자명(슬래시 앞)과 일치하면 완료로 본다.
    // - 연락처는 비교하지 않는다(사용자 요구사항).
    if (!(afterName !== '' && currentName === afterName)) {
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
    try {
      const res = await notifyRequesterOfManagerChangeCompleted(db, requestId);
      if (!('skipped' in res)) notified += res.sent;
    } catch {
      // 알림 실패는 동기화 실패로 처리하지 않는다.
    }
  }

  return { scanned: list.length, completed, notified, skipped };
}

