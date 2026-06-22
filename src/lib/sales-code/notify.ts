/**
 * 영업자 코드 발급 신청(sales_code_requests) 상태 변화 → push 알림 helper.
 *
 * 두 종류의 알림을 다룬다.
 *   1) 반려 알림  : 관리자가 신청을 '반려' 처리 → 신청자에게 반려 사유를 푸시.
 *   2) 완료 처리  : 계정 발급 페이지(/admin/account-issue) Google Sheet 동기화 등으로
 *                  같은 이름 + 전화번호의 user_profiles 계정이 실제 발급된 직후,
 *                  매칭된 sales_code_requests 를 status='처리완료' 로 전이.
 *                  푸시는 구독이 있을 때만 시도하며, completed_notified_at 은 발송 성공 시에만 기록.
 *
 * 모든 발송은 `loadSubscriptionsForSend` + `sendWebPushToSubscriptions` 를 재사용한다.
 * 중복 발송 방지를 위해 발송 직후 `rejected_notified_at` / `completed_notified_at` 컬럼을
 * timestamp 로 기록한다. 컬럼이 이미 NOT NULL 인 row 는 발송하지 않는다.
 *
 * 본 모듈은 정산/조직도/TY/계정 발급/시트 쓰기 본체 로직을 일절 수정하지 않는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadSubscriptionsForSend,
  sendWebPushToSubscriptions,
} from '@/lib/push/send';

/** 전화번호에서 숫자만 추출. null/undefined/빈문자열 → ''. */
export function normalizePhoneDigits(input: string | null | undefined): string {
  return String(input ?? '').replace(/\D/g, '');
}

const REJECT_NOTIFY_URL = '/organization/code-request';
const COMPLETE_NOTIFY_URL = '/organization/code-request';

const isDev = process.env.NODE_ENV !== 'production';
const logVerbose = (label: string, payload: unknown): void => {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console.log(`[sales-code-notification:${label}]`, payload);
};
const logError = (payload: { requestId?: string | null; stage: string; message: string }): void => {
  // eslint-disable-next-line no-console
  console.error('[sales-code-notification:error]', payload);
};

/** 본문 길이를 안전하게 자른다 (web-push payload 한계 고려, 한국어 기준 200자 여유). */
function trimBody(s: string, max = 400): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * 반려 알림: 해당 신청(`requestId`) 의 applicant_user_id 로 push 발송 후
 * rejected_notified_at 을 now() 로 마킹한다.
 *
 * - `rejected_notified_at IS NULL` 인 경우에만 실행 (중복 발송 방지).
 * - 푸시 발송 실패해도 timestamp 는 기록하지 않아 다음 시도 가능.
 */
export async function notifySalesCodeRejected(
  db: SupabaseClient,
  requestId: string,
): Promise<{ sent: number; failed: number } | null> {
  if (!requestId) return null;

  const { data, error } = await db
    .from('sales_code_requests')
    .select(
      'id, applicant_user_id, applicant_name, name, rejection_reason, memo, status, rejected_notified_at',
    )
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    logError({ requestId, stage: 'select_request', message: error.message });
    return null;
  }
  if (!data) {
    logError({ requestId, stage: 'select_request', message: 'request not found' });
    return null;
  }

  const row = data as {
    id: string;
    applicant_user_id: string | null;
    applicant_name: string | null;
    name: string | null;
    rejection_reason: string | null;
    memo: string | null;
    status: string | null;
    rejected_notified_at: string | null;
  };

  if (row.status !== '반려') return null;
  if (row.rejected_notified_at) return null;
  if (!row.applicant_user_id) {
    logError({ requestId, stage: 'select_request', message: 'applicant_user_id 없음' });
    return null;
  }

  const reason = (row.rejection_reason ?? '').trim() || (row.memo ?? '').trim();
  const targetName = (row.name ?? '').trim();

  const title = '영업자 코드 발급 신청이 반려되었습니다.';
  const body = trimBody(
    reason
      ? `${targetName ? `${targetName}님 신청 · ` : ''}반려 사유: ${reason}`
      : `${targetName ? `${targetName}님 신청이 ` : ''}반려되었습니다.`,
  );

  logVerbose('rejected', {
    requestId,
    applicantUserId: row.applicant_user_id,
    name: targetName,
    rejectReason: reason,
  });

  let sent = 0;
  let failed = 0;
  try {
    const subs = await loadSubscriptionsForSend(db, row.applicant_user_id);
    if (subs.length > 0) {
      const res = await sendWebPushToSubscriptions(db, {
        subscriptions: subs,
        title,
        body,
        url: REJECT_NOTIFY_URL,
      });
      sent = res.sent;
      failed = res.failed;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError({ requestId, stage: 'push_send_rejected', message: msg });
    // 발송 자체가 실패한 경우 timestamp 를 남기지 않아 재시도 여지 보존.
    return { sent, failed: failed || 1 };
  }

  // 푸시 발송이 전부 실패해도(예: 구독 없음) timestamp 는 한 번 기록하지 않는다 — 다음 시도 가능.
  // 단, 한 건이라도 sent 가 있다면 중복 발송 방지를 위해 timestamp 마킹.
  if (sent > 0) {
    const { error: uErr } = await db
      .from('sales_code_requests')
      .update({ rejected_notified_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('rejected_notified_at', null);
    if (uErr) {
      logError({ requestId, stage: 'mark_rejected_notified_at', message: uErr.message });
    }
  }

  return { sent, failed };
}

/**
 * 계정 발급 완료 매칭 & 상태 전이:
 *   조건:
 *     - sales_code_requests.name = name (정확 일치)
 *     - phone_digits = normalizePhoneDigits(phone)
 *     - status IN ('시트등록완료')
 *     - completed_notified_at IS NULL (아직 완료 처리 루프 미실행)
 *
 *   계정 발급 성공 시: status='처리완료' 로 즉시 전이 (푸시 여부와 무관).
 *   푸시: applicant_user_id + 구독이 있을 때만 시도, sent > 0 이면 completed_notified_at 기록.
 *
 * 호출 시점: account-issue sheet sync 등에서 user_profiles 가 실제로 발급/매핑된 직후.
 * (Google Sheet 동기화 버튼 클릭이 아니라 DB 발급이 확정된 직후가 핵심)
 */
export async function notifySalesCodeCompletedForAccount(
  db: SupabaseClient,
  args: {
    name: string;
    phone: string | null | undefined;
    /** 추적용 - 발급된 user_profiles.id 등. 없으면 로그에만 사용. */
    matchedAccountId?: string | null;
  },
): Promise<Array<{ requestId: string; sent: number; failed: number }>> {
  const name = String(args.name ?? '').trim();
  const phoneDigits = normalizePhoneDigits(args.phone);
  if (!name || !phoneDigits) return [];

  // 1) 매칭 후보 조회
  const { data, error } = await db
    .from('sales_code_requests')
    .select(
      'id, applicant_user_id, applicant_name, name, phone, phone_digits, status, completed_notified_at',
    )
    .eq('name', name)
    .eq('phone_digits', phoneDigits)
    .in('status', ['시트등록완료'])
    .is('completed_notified_at', null);
  if (error) {
    logError({
      requestId: null,
      stage: 'select_match_candidates',
      message: error.message,
    });
    return [];
  }
  const rows = (data ?? []) as Array<{
    id: string;
    applicant_user_id: string | null;
    applicant_name: string | null;
    name: string | null;
    phone: string | null;
    phone_digits: string | null;
    status: string;
    completed_notified_at: string | null;
  }>;

  const results: Array<{ requestId: string; sent: number; failed: number }> = [];

  for (const row of rows) {
    const { error: statusErr } = await db
      .from('sales_code_requests')
      .update({ status: '처리완료' })
      .eq('id', row.id)
      .eq('status', '시트등록완료');
    if (statusErr) {
      logError({ requestId: row.id, stage: 'mark_completed_status', message: statusErr.message });
      continue;
    }

    logVerbose('completed-match', {
      requestId: row.id,
      applicantUserId: row.applicant_user_id,
      name: row.name,
      phone: row.phone,
      matchedAccountId: args.matchedAccountId ?? null,
    });

    if (!row.applicant_user_id) {
      logError({ requestId: row.id, stage: 'push_send_completed', message: 'applicant_user_id 없음 (상태만 처리완료)' });
      results.push({ requestId: row.id, sent: 0, failed: 0 });
      continue;
    }

    const title = '코드 발급이 완료되었습니다.';
    const body = trimBody(
      `${name}님의 영업자 코드 발급이 완료되었습니다. 앱에서 계정 정보를 확인해주세요.`,
    );

    let sent = 0;
    let failed = 0;
    try {
      const subs = await loadSubscriptionsForSend(db, row.applicant_user_id);
      if (subs.length > 0) {
        const res = await sendWebPushToSubscriptions(db, {
          subscriptions: subs,
          title,
          body,
          url: COMPLETE_NOTIFY_URL,
        });
        sent = res.sent;
        failed = res.failed;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logError({ requestId: row.id, stage: 'push_send_completed', message: msg });
      results.push({ requestId: row.id, sent: 0, failed: 1 });
      continue;
    }

    if (sent > 0) {
      const { error: uErr } = await db
        .from('sales_code_requests')
        .update({ completed_notified_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('completed_notified_at', null);
      if (uErr) {
        logError({ requestId: row.id, stage: 'mark_completed_notified_at', message: uErr.message });
      }
    }

    results.push({ requestId: row.id, sent, failed });
  }

  return results;
}
