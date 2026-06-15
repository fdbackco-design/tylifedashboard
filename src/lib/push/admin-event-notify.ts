/**
 * 관리자 대상 이벤트성 푸시 알림 (신규 계약 / 영업자 코드 신청).
 *
 * 중복 발송 방지 정책:
 *  - sync_runs.admin_notified_at        : 한 sync 결과 1회만 발송
 *  - sales_code_requests.admin_notified_at: 한 신청 1회만 발송
 *
 * 알림 전송 자체가 실패해도 호출자(sync, 신청 생성)는 정상 처리한다.
 * timestamp 마킹은 "한 건이라도 sent > 0" 일 때만 수행하여 다음 실행에서 재시도 가능.
 *
 * 본 모듈은 정산/계약/조직도/계정 발급 본체 로직을 일절 수정하지 않는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendAdminPushNotification } from './admin-notify';

const isDev = process.env.NODE_ENV !== 'production';

function log(level: 'log' | 'warn' | 'error', label: string, payload: unknown): void {
  if (level === 'log' && !isDev) return;
  // eslint-disable-next-line no-console
  console[level](`[admin-event-notify:${label}]`, payload);
}

function trimBody(s: string, max = 400): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * TY 동기화가 끝난 직후 호출. 해당 sync_run 의 total_created > 0 이고
 * 아직 알림을 보낸 적이 없으면(admin_notified_at IS NULL) 관리자들에게 알림 발송.
 *
 * @returns 발송 결과 또는 발송 안 함 (skipped: 'already_notified' | 'no_new_contracts' | 'run_missing')
 */
export async function notifyAdminsOfNewContracts(
  db: SupabaseClient,
  syncRunId: string,
): Promise<
  | { skipped: 'already_notified' | 'no_new_contracts' | 'run_missing' }
  | { sent: number; failed: number; newContractCount: number }
> {
  if (!syncRunId) return { skipped: 'run_missing' };

  const { data: run, error: rErr } = await db
    .from('sync_runs')
    .select('id, total_created, admin_notified_at, finished_at, status')
    .eq('id', syncRunId)
    .maybeSingle();
  if (rErr) {
    log('error', 'select_sync_run', { syncRunId, message: rErr.message });
    return { skipped: 'run_missing' };
  }
  if (!run) return { skipped: 'run_missing' };

  const row = run as {
    id: string;
    total_created: number | null;
    admin_notified_at: string | null;
    finished_at: string | null;
    status: string | null;
  };
  const newContractCount = Number(row.total_created ?? 0);

  if (row.admin_notified_at) return { skipped: 'already_notified' };
  if (newContractCount <= 0) return { skipped: 'no_new_contracts' };

  // 최근 신규 계약 ID/요약은 알림 payload 에는 넣지 않는다 (PII/길이/장기보존 이슈).
  // 클릭 시 /admin/contracts 로 이동.
  const title = '신규 계약이 등록되었습니다';
  const body = trimBody(`TY 동기화로 신규 계약 ${newContractCount.toLocaleString('ko-KR')}건이 등록되었습니다.`);

  const result = await sendAdminPushNotification(db, {
    title,
    body,
    url: '/admin/contracts',
  });

  log('log', 'new_contracts_result', { syncRunId, newContractCount, result });

  if (result.sent > 0) {
    const { error: uErr } = await db
      .from('sync_runs')
      .update({ admin_notified_at: new Date().toISOString() })
      .eq('id', syncRunId)
      .is('admin_notified_at', null);
    if (uErr) {
      log('error', 'mark_admin_notified_at', { syncRunId, message: uErr.message });
    }
  }

  return {
    sent: result.sent,
    failed: result.failed,
    newContractCount,
  };
}

/**
 * 영업자 코드 발급 신청이 새로 생성되었을 때 호출. 한 신청 당 1회만 발송.
 *
 * @returns 발송 결과 또는 발송 안 함
 */
export async function notifyAdminsOfSalesCodeRequest(
  db: SupabaseClient,
  requestId: string,
): Promise<
  | { skipped: 'already_notified' | 'request_missing' }
  | { sent: number; failed: number; applicantName: string }
> {
  if (!requestId) return { skipped: 'request_missing' };

  const { data, error } = await db
    .from('sales_code_requests')
    .select('id, applicant_name, name, phone, phone_digits, status, admin_notified_at, requested_at')
    .eq('id', requestId)
    .maybeSingle();
  if (error) {
    log('error', 'select_request', { requestId, message: error.message });
    return { skipped: 'request_missing' };
  }
  if (!data) return { skipped: 'request_missing' };

  const row = data as {
    id: string;
    applicant_name: string | null;
    name: string | null;
    phone: string | null;
    phone_digits: string | null;
    status: string | null;
    admin_notified_at: string | null;
    requested_at: string | null;
  };
  if (row.admin_notified_at) return { skipped: 'already_notified' };

  const applicantName = (row.applicant_name ?? '').trim() || (row.name ?? '').trim() || '신청자';
  const targetName = (row.name ?? '').trim();

  const title = '영업자 코드 발급 신청';
  const body = trimBody(
    targetName && targetName !== applicantName
      ? `${applicantName}님이 ${targetName}님 영업자 코드 발급을 신청했습니다.`
      : `${applicantName}님이 영업자 코드 발급을 신청했습니다.`,
  );

  const result = await sendAdminPushNotification(db, {
    title,
    body,
    url: '/admin/newcode',
  });

  log('log', 'sales_code_request_result', { requestId, applicantName, result });

  if (result.sent > 0) {
    const { error: uErr } = await db
      .from('sales_code_requests')
      .update({ admin_notified_at: new Date().toISOString() })
      .eq('id', requestId)
      .is('admin_notified_at', null);
    if (uErr) {
      log('error', 'mark_admin_notified_at', { requestId, message: uErr.message });
    }
  }

  return {
    sent: result.sent,
    failed: result.failed,
    applicantName,
  };
}
