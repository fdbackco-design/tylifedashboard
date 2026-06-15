/**
 * 관리자(여러 명) 대상 푸시 알림 헬퍼.
 *
 * 관리자 판별 기준: `user_profiles.role = 'admin' AND is_active = true`
 *  - admin layout(`src/app/admin/layout.tsx`) 과 동일한 기준이다.
 *
 * 알림 발송 실패는 호출자에게 throw 하지 않는다 — caller(sync, 신청 생성 등)의 본업이
 * 알림 때문에 중단되면 안 된다. 결과 객체로만 보고한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadSubscriptionsForSend,
  sendWebPushToSubscriptions,
} from './send';
import type { PushSubscriptionRow } from './types';

const isDev = process.env.NODE_ENV !== 'production';

function log(level: 'log' | 'warn' | 'error', label: string, payload: unknown): void {
  if (level === 'log' && !isDev) return;
  // eslint-disable-next-line no-console
  console[level](`[admin-notify:${label}]`, payload);
}

/**
 * 관리자(role='admin' AND is_active=true) 의 user_profiles.id 목록을 반환한다.
 */
export async function getAdminUserIds(db: SupabaseClient): Promise<string[]> {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, role, is_active')
    .eq('role', 'admin')
    .eq('is_active', true);
  if (error) {
    log('error', 'getAdminUserIds', { message: error.message });
    return [];
  }
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
}

/**
 * 관리자 다수에게 푸시 알림을 발송한다.
 * 어떤 한 관리자/엔드포인트에서 실패하더라도 전체가 실패하지 않는다.
 *
 * @returns 누적 결과 (sent: 성공한 endpoint 수, failed: 실패한 endpoint 수, ...)
 */
export async function sendAdminPushNotification(
  db: SupabaseClient,
  opts: {
    title: string;
    body: string;
    url: string;
  },
): Promise<{
  sent: number;
  failed: number;
  removed: number;
  adminCount: number;
  subscriptionCount: number;
  errors: string[];
}> {
  let adminIds: string[] = [];
  try {
    adminIds = await getAdminUserIds(db);
  } catch (e) {
    log('error', 'getAdminUserIds', { message: (e as Error).message });
    return { sent: 0, failed: 0, removed: 0, adminCount: 0, subscriptionCount: 0, errors: [(e as Error).message] };
  }
  if (adminIds.length === 0) {
    log('warn', 'no_admins', { title: opts.title });
    return { sent: 0, failed: 0, removed: 0, adminCount: 0, subscriptionCount: 0, errors: [] };
  }

  let subscriptions: PushSubscriptionRow[] = [];
  try {
    const all = await Promise.all(adminIds.map((uid) => loadSubscriptionsForSend(db, uid)));
    subscriptions = all.flat();
  } catch (e) {
    log('error', 'loadSubscriptionsForSend', { message: (e as Error).message });
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      adminCount: adminIds.length,
      subscriptionCount: 0,
      errors: [(e as Error).message],
    };
  }

  if (subscriptions.length === 0) {
    log('warn', 'no_subscriptions', { adminCount: adminIds.length, title: opts.title });
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      adminCount: adminIds.length,
      subscriptionCount: 0,
      errors: [],
    };
  }

  try {
    const res = await sendWebPushToSubscriptions(db, {
      subscriptions,
      title: opts.title,
      body: opts.body,
      url: opts.url,
    });
    return {
      sent: res.sent,
      failed: res.failed,
      removed: res.removed,
      adminCount: adminIds.length,
      subscriptionCount: subscriptions.length,
      errors: res.errors,
    };
  } catch (e) {
    log('error', 'sendWebPushToSubscriptions', { message: (e as Error).message });
    return {
      sent: 0,
      failed: subscriptions.length,
      removed: 0,
      adminCount: adminIds.length,
      subscriptionCount: subscriptions.length,
      errors: [(e as Error).message],
    };
  }
}
