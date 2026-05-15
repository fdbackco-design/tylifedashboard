import type { SupabaseClient } from '@supabase/supabase-js';
import { noticeContentSummary } from './content-utils';
import { getNoticeDisplayStatus } from './status';
import type { NoticeRow } from './types';
import { noticeDetailPath, resolvePushNotificationUrl } from '@/lib/push/notification-url';
import { loadSubscriptionsForSend, sendWebPushToSubscriptions } from '@/lib/push/send';
import type { PushSendResult } from '@/lib/push/types';
import { assertVapidConfigured } from '@/lib/push/vapid';

export type NoticePushOutcome =
  | { sent: false; reason: string }
  | { sent: true; result: PushSendResult };

/** 게시 중이고 푸시 ON이며 아직 발송하지 않은 공지 */
export function shouldSendNoticePush(row: NoticeRow): boolean {
  if (!row.send_push) return false;
  if (row.is_draft || row.is_stopped) return false;
  if (getNoticeDisplayStatus(row) !== 'published') return false;
  if (row.push_sent_at) return false;
  return true;
}

function skipReason(row: NoticeRow): string {
  if (!row.send_push) return '푸시 발송 옵션이 꺼져 있습니다.';
  if (row.is_draft) return '임시저장 상태에서는 푸시를 보내지 않습니다.';
  if (getNoticeDisplayStatus(row) === 'scheduled') {
    return '예약 게시 공지는 게시 시작일(한국시간)에 자동 푸시됩니다.';
  }
  if (getNoticeDisplayStatus(row) === 'stopped') {
    return '게시 중지 상태에서는 푸시를 보내지 않습니다.';
  }
  if (row.push_sent_at) return '이미 푸시가 발송된 공지입니다.';
  return '푸시를 발송할 수 없습니다.';
}

/**
 * 게시 직후 전체 푸시 구독자에게 발송. 탭 시 공지 상세(/organization/notice/[id])로 이동.
 * 본문에는 제목·요약만 사용 (민감 정보 금지).
 */
export async function maybeSendNoticePush(db: SupabaseClient, row: NoticeRow): Promise<NoticePushOutcome> {
  if (!shouldSendNoticePush(row)) {
    return { sent: false, reason: skipReason(row) };
  }

  try {
    assertVapidConfigured();
  } catch (e) {
    return {
      sent: false,
      reason: e instanceof Error ? e.message : 'VAPID 미설정',
    };
  }

  const subscriptions = await loadSubscriptionsForSend(db);
  if (!subscriptions.length) {
    return { sent: false, reason: '푸시 구독자가 없습니다.' };
  }

  const summary = noticeContentSummary(row.content, 120);
  const body = summary || '새 공지사항이 등록되었습니다.';

  const result = await sendWebPushToSubscriptions(db, {
    subscriptions,
    title: row.title,
    body,
    url: resolvePushNotificationUrl(noticeDetailPath(row.id)),
  });

  if (result.sent > 0) {
    await db.from('notices').update({ push_sent_at: new Date().toISOString() }).eq('id', row.id);
  }

  return { sent: true, result };
}

export type DueNoticePushItem = {
  id: string;
  title: string;
  outcome: NoticePushOutcome;
};

export type ProcessDueNoticePushesResult = {
  /** DB 후보 건수 (푸시 ON·미발송·게시 설정) */
  candidates: number;
  /** 실제 발송 시도 대상 (게시중 상태) */
  due: number;
  sent: number;
  items: DueNoticePushItem[];
};

/**
 * 게시 시작일이 된 예약 공지 등, 아직 푸시가 나가지 않은 게시중 공지를 일괄 발송.
 * Vercel Cron `/api/cron/notice-push` 에서 호출.
 */
export async function processDueNoticePushes(db: SupabaseClient): Promise<ProcessDueNoticePushesResult> {
  const { data, error } = await db
    .from('notices')
    .select('*')
    .eq('send_push', true)
    .is('push_sent_at', null)
    .eq('is_draft', false)
    .eq('is_stopped', false);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as NoticeRow[];
  const dueRows = rows.filter((row) => shouldSendNoticePush(row));

  const items: DueNoticePushItem[] = [];
  let sent = 0;

  for (const row of dueRows) {
    const outcome = await maybeSendNoticePush(db, row);
    items.push({ id: row.id, title: row.title, outcome });
    if (outcome.sent) sent += 1;
  }

  return { candidates: rows.length, due: dueRows.length, sent, items };
}
