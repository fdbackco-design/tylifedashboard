/**
 * 담당자 변경 신청 푸시 알림.
 */

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendAdminPushNotification } from '@/lib/push/admin-notify';
import { loadSubscriptionsForSend, sendWebPushToSubscriptions } from '@/lib/push/send';

const BRANCH_NAME = 'Ty Life Partners';
const ADMIN_URL = '/admin/manager-change';
const MEMBER_URL = '/organization/manager-change';

function trimBody(s: string, max = 400): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** 신청 접수 → 관리자 알림 (중복 방지: admin_notified_at) */
export async function notifyAdminsOfManagerChangeRequest(
  db: SupabaseClient,
  requestId: string,
): Promise<{ sent: number; failed: number } | { skipped: string }> {
  if (!requestId) return { skipped: 'missing_id' };

  const { data, error } = await db
    .from('manager_change_requests')
    .select('id, customer_name, status, admin_notified_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !data) return { skipped: 'not_found' };

  const row = data as {
    id: string;
    customer_name: string | null;
    status: string | null;
    admin_notified_at: string | null;
  };
  if (row.admin_notified_at) return { skipped: 'already_notified' };
  if (row.status !== 'PENDING') return { skipped: 'not_pending' };

  const customerName = (row.customer_name ?? '').trim() || '고객';
  const result = await sendAdminPushNotification(db, {
    title: '담당자 변경 신청',
    body: trimBody(`새 담당자 변경 신청이 접수되었습니다. 고객명: ${customerName}`),
    url: ADMIN_URL,
  });

  if (result.sent > 0) {
    await db
      .from('manager_change_requests')
      .update({ admin_notified_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('admin_notified_at', null);
  }

  return { sent: result.sent, failed: result.failed };
}

/** 완료 처리 → 신청 영업자 알림 (중복 방지: completed_notified_at) */
export async function notifyRequesterOfManagerChangeCompleted(
  db: SupabaseClient,
  requestId: string,
): Promise<{ sent: number; failed: number } | { skipped: string }> {
  if (!requestId) return { skipped: 'missing_id' };

  const { data, error } = await db
    .from('manager_change_requests')
    .select('id, requester_user_id, customer_name, status, completed_notified_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !data) return { skipped: 'not_found' };

  const row = data as {
    id: string;
    requester_user_id: string | null;
    customer_name: string | null;
    status: string | null;
    completed_notified_at: string | null;
  };
  if (row.completed_notified_at) return { skipped: 'already_notified' };
  if (row.status !== 'COMPLETED') return { skipped: 'not_completed' };
  if (!row.requester_user_id) return { skipped: 'no_requester' };

  const customerName = (row.customer_name ?? '').trim() || '고객';
  const subs = await loadSubscriptionsForSend(db, row.requester_user_id);
  if (!subs.length) return { skipped: 'no_subscriptions' };

  const result = await sendWebPushToSubscriptions(db, {
    subscriptions: subs,
    title: '담당자 변경 완료',
    body: trimBody(`담당자 변경 신청이 완료되었습니다. 고객명: ${customerName}`),
    url: MEMBER_URL,
  });

  if (result.sent > 0) {
    await db
      .from('manager_change_requests')
      .update({ completed_notified_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('completed_notified_at', null);
  }

  return { sent: result.sent, failed: result.failed };
}

/** 반려 처리 → 신청 영업자 알림 (중복 방지: rejected_notified_at) */
export async function notifyRequesterOfManagerChangeRejected(
  db: SupabaseClient,
  requestId: string,
): Promise<{ sent: number; failed: number } | { skipped: string }> {
  if (!requestId) return { skipped: 'missing_id' };

  const { data, error } = await db
    .from('manager_change_requests')
    .select('id, requester_user_id, customer_name, status, rejection_reason, rejected_notified_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error || !data) return { skipped: 'not_found' };

  const row = data as {
    id: string;
    requester_user_id: string | null;
    customer_name: string | null;
    status: string | null;
    rejection_reason: string | null;
    rejected_notified_at: string | null;
  };
  if (row.rejected_notified_at) return { skipped: 'already_notified' };
  if (row.status !== 'REJECTED') return { skipped: 'not_rejected' };
  if (!row.requester_user_id) return { skipped: 'no_requester' };

  const customerName = (row.customer_name ?? '').trim() || '고객';
  const reason = (row.rejection_reason ?? '').trim();
  const subs = await loadSubscriptionsForSend(db, row.requester_user_id);
  if (!subs.length) return { skipped: 'no_subscriptions' };

  const result = await sendWebPushToSubscriptions(db, {
    subscriptions: subs,
    title: '담당자 변경 신청이 반려되었습니다.',
    body: trimBody(
      reason
        ? `고객명: ${customerName} · 반려 사유: ${reason}`
        : `고객명: ${customerName} · 담당자 변경 신청이 반려되었습니다.`,
    ),
    url: MEMBER_URL,
  });

  if (result.sent > 0) {
    await db
      .from('manager_change_requests')
      .update({ rejected_notified_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('rejected_notified_at', null);
  }

  return { sent: result.sent, failed: result.failed };
}

export { BRANCH_NAME };
