import type { SupabaseClient } from '@supabase/supabase-js';
import { noticeContentSummary } from './content-utils';
import { getNoticeDisplayStatus } from './status';
import type { NoticeRow } from './types';
import { loadSubscriptionsForSend, sendWebPushToSubscriptions } from '@/lib/push/send';
import type { PushSendResult } from '@/lib/push/types';
import { assertVapidConfigured } from '@/lib/push/vapid';

export type NoticePushOutcome =
  | { sent: false; reason: string }
  | { sent: true; result: PushSendResult };

/** 게시 저장 시 푸시를 보낼지 판단 (중복 발송 방지) */
export function shouldSendNoticePush(before: NoticeRow | null, after: NoticeRow): boolean {
  if (!after.send_push) return false;
  if (after.is_draft || after.is_stopped) return false;
  if (getNoticeDisplayStatus(after) !== 'published') return false;

  if (!before) return true;
  if (!before.send_push) return true;
  if (getNoticeDisplayStatus(before) !== 'published') return true;

  return false;
}

/**
 * 공지 게시와 함께 전체 구독자에게 푸시 발송.
 * 본문에는 제목·요약만 사용 (민감 정보 금지).
 */
export async function maybeSendNoticePush(
  db: SupabaseClient,
  before: NoticeRow | null,
  after: NoticeRow,
): Promise<NoticePushOutcome> {
  if (!shouldSendNoticePush(before, after)) {
    if (!after.send_push) {
      return { sent: false, reason: '푸시 발송 옵션이 꺼져 있습니다.' };
    }
    if (after.is_draft) {
      return { sent: false, reason: '임시저장 상태에서는 푸시를 보내지 않습니다.' };
    }
    if (getNoticeDisplayStatus(after) === 'scheduled') {
      return { sent: false, reason: '예약 게시 공지는 게시일에 맞춰 앱에서 확인됩니다. (푸시는 즉시 발송되지 않음)' };
    }
    if (getNoticeDisplayStatus(after) === 'stopped') {
      return { sent: false, reason: '게시 중지 상태에서는 푸시를 보내지 않습니다.' };
    }
    return { sent: false, reason: '이미 발송된 공지입니다. 내용만 수정되었습니다.' };
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

  const summary = noticeContentSummary(after.content, 120);
  const body = summary || '새 공지사항이 등록되었습니다.';

  const result = await sendWebPushToSubscriptions(db, {
    subscriptions,
    title: after.title,
    body,
    url: `/organization/notice/${after.id}`,
  });

  return { sent: true, result };
}
