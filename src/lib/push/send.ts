import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { configureWebPush } from './vapid';
import type { PushSendResult, PushSubscriptionRow } from './types';

/**
 * 푸시 본문에는 주민번호·계약 상세 등 민감 정보를 넣지 마세요.
 * 제목·요약·이동 URL 정도만 사용하는 것을 권장합니다.
 */
export async function sendWebPushToSubscriptions(
  db: SupabaseClient,
  opts: {
    subscriptions: PushSubscriptionRow[];
    title: string;
    body: string;
    url: string;
  },
): Promise<PushSendResult> {
  configureWebPush();

  const payload = JSON.stringify({
    title: opts.title,
    body: opts.body,
    url: opts.url,
  });

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const errors: string[] = [];
  const staleEndpoints: string[] = [];

  await Promise.all(
    opts.subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
        );
        sent += 1;
      } catch (e) {
        failed += 1;
        const status = (e as { statusCode?: number }).statusCode;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg.slice(0, 200));
        if (status === 404 || status === 410) {
          staleEndpoints.push(row.endpoint);
        }
      }
    }),
  );

  if (staleEndpoints.length > 0) {
    const { error } = await db.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
    if (!error) removed = staleEndpoints.length;
  }

  return { sent, failed, removed, errors: errors.slice(0, 5) };
}

export async function loadSubscriptionsForSend(
  db: SupabaseClient,
  targetUserId?: string,
): Promise<PushSubscriptionRow[]> {
  let q = db.from('push_subscriptions').select('*');
  if (targetUserId) q = q.eq('user_id', targetUserId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PushSubscriptionRow[];
}
