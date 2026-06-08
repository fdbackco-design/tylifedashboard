/**
 * /admin/account-issue 의 "구글 시트 동기화" 기능 핵심 로직.
 *
 * 흐름:
 *   1. Google Sheets 의 '시트1'!A5:N 범위 조회
 *   2. 실제 행 번호 = index + 5
 *   3. M열(row[12]) 가 비어있는 행만 처리
 *   4. B열(이름) 으로 organization_members 후보 검색
 *      - 후보 1명: 그 대상에게 발급
 *      - 후보 2명 이상: E열(전화번호) 로 추가 매칭 → 정확히 1명일 때만 발급
 *      - 그 외: 자동 발급 안 함, N열에 실패 사유 기록
 *   5. G열 값을 login_code + 비밀번호로 사용 (8자리 숫자만 허용)
 *   6. 성공: M열='ㅇ', N열=''
 *   7. 실패: M열='', N열=실패사유
 *
 * 보안:
 *   - 비밀번호 원문은 로그/응답에 새지 않도록 마스킹된 표현만 노출
 *   - account_mapping_logs 에 감사 로그를 남기되 비밀번호는 저장하지 않음
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sheetsValuesGet,
  sheetsSetCell,
} from '@/lib/google/sheets-client';
import {
  findUserProfileByLoginCode,
  issueMappedAccount,
  isValid8Digits,
} from '@/lib/account-issue/issue';
import { normalizePhone } from '@/lib/account-issue/normalize';

export type SheetSyncRowResult = {
  rowNumber: number;
  name: string;
  /** 응답에는 마스킹된 표현만 노출 */
  phone?: string;
  /** 응답에는 마스킹된 표현만 노출 */
  loginId: string;
  result: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  reason?: string;
};

export type SheetSyncResult = {
  sheetName: string;
  totalRows: number;
  targetRows: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  results: SheetSyncRowResult[];
};

function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const d = phone.replace(/\D/g, '');
  if (d.length < 7) return '****';
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}

function maskLoginId(loginId: string): string {
  if (!loginId) return '';
  if (loginId.length <= 4) return '****';
  return `${loginId.slice(0, 2)}****${loginId.slice(-2)}`;
}

/**
 * 이름(+선택적으로 전화번호) 으로 organization_members 후보를 조회한다.
 * - 본사 노드와 비활성 행은 제외
 */
async function searchPersonCandidatesByName(
  adminDb: SupabaseClient,
  name: string,
): Promise<Array<{ id: string; name: string; rank: string | null; phone: string | null; source_customer_id: string | null }>> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return [];
  const { data } = await adminDb
    .from('organization_members')
    .select('id, name, rank, phone, source_customer_id, is_active')
    .eq('is_active', true)
    .ilike('name', `%${trimmed}%`)
    .limit(50);

  // ilike 는 부분 일치라 다른 이름이 섞일 수 있다 → 트림 후 정확 일치만 후보로 채택
  const eqName = trimmed.replace(/^\[고객\]\s*/, '');
  return ((data ?? []) as any[])
    .filter((m) => (m.rank ?? '') !== '본사')
    .filter((m) => {
      const n = String(m.name ?? '').replace(/^\[고객\]\s*/, '').trim();
      return n === eqName;
    })
    .map((m) => ({
      id: m.id as string,
      name: m.name as string,
      rank: (m.rank ?? null) as string | null,
      phone: (m.phone ?? null) as string | null,
      source_customer_id: (m.source_customer_id ?? null) as string | null,
    }));
}

/** Google Sheets 범위 식 (시트명 인용 부호 포함). 한글 시트명 안전. */
function buildRange(sheetName: string, a1: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!${a1}`;
}

/**
 * /admin/account-issue 구글 시트 동기화 실행.
 *
 * @param adminDb     service_role Supabase 클라이언트
 * @param opts        spreadsheetId / sheetName (환경변수 미설정 시 인자로 전달 가능)
 * @returns           처리 요약 + 행별 결과
 */
export async function syncAccountIssueFromGoogleSheet(
  adminDb: SupabaseClient,
  opts?: { spreadsheetId?: string; sheetName?: string },
): Promise<SheetSyncResult> {
  const spreadsheetId =
    (opts?.spreadsheetId ?? process.env.ACCOUNT_ISSUE_SHEET_ID ?? '').trim();
  const sheetName =
    (opts?.sheetName ?? process.env.ACCOUNT_ISSUE_SHEET_NAME ?? '시트1').trim() || '시트1';

  if (!spreadsheetId) {
    throw new Error('ACCOUNT_ISSUE_SHEET_ID 환경변수가 설정되지 않았습니다.');
  }

  const readRange = buildRange(sheetName, 'A5:N');

  let rows: string[][];
  try {
    rows = await sheetsValuesGet(spreadsheetId, readRange);
  } catch (e) {
    throw new Error(
      `Google Sheets 조회 오류: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const out: SheetSyncResult = {
    sheetName,
    totalRows: rows.length,
    targetRows: 0,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    results: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowNumber = i + 5;
    const name = String(r[1] ?? '').trim();
    const phoneRaw = String(r[4] ?? '').trim();
    const accountValue = String(r[6] ?? '').trim();
    const status = String(r[12] ?? '').trim();

    // 빈 행은 통계에서 제외 (B/G 모두 비어있고 M도 비어있으면 무시)
    if (!name && !accountValue && !status) {
      continue;
    }

    // 이미 처리된 행은 스킵
    if (status) {
      out.skippedCount++;
      continue;
    }

    if (!name) {
      // 이름 없는 행은 자동 발급 대상에서 제외 (사유만 기록)
      out.targetRows++;
      await writeFailure(spreadsheetId, sheetName, rowNumber, '실패: 이름 없음');
      out.failedCount++;
      out.results.push({
        rowNumber,
        name: '',
        loginId: maskLoginId(accountValue),
        result: 'FAILED',
        reason: '실패: 이름 없음',
      });
      continue;
    }

    if (!accountValue) {
      out.targetRows++;
      await writeFailure(spreadsheetId, sheetName, rowNumber, '실패: 계정값 없음');
      out.failedCount++;
      out.results.push({
        rowNumber,
        name,
        phone: maskPhone(phoneRaw),
        loginId: '',
        result: 'FAILED',
        reason: '실패: 계정값 없음',
      });
      continue;
    }

    out.targetRows++;

    // 계정값 형식 검증 (loginId 와 password 가 동일한 8자리 숫자)
    if (!isValid8Digits(accountValue)) {
      const reason = '실패: 계정값 형식 오류(8자리 숫자만 허용)';
      await writeFailure(spreadsheetId, sheetName, rowNumber, reason);
      out.failedCount++;
      out.results.push({
        rowNumber,
        name,
        phone: maskPhone(phoneRaw),
        loginId: maskLoginId(accountValue),
        result: 'FAILED',
        reason,
      });
      continue;
    }

    // 로그인 ID 중복 검사 (해당 8자리가 이미 다른 행에 발급되었는지)
    try {
      const dup = await findUserProfileByLoginCode(adminDb, accountValue);
      if (dup?.id) {
        const reason = '실패: 로그인 ID 중복';
        await writeFailure(spreadsheetId, sheetName, rowNumber, reason);
        out.failedCount++;
        out.results.push({
          rowNumber,
          name,
          phone: maskPhone(phoneRaw),
          loginId: maskLoginId(accountValue),
          result: 'FAILED',
          reason,
        });
        await logMapping(adminDb, { action: 'SHEET_SYNC_DUPLICATE_LOGIN', rowNumber, name, phone: phoneRaw, loginId: accountValue, reason });
        continue;
      }
    } catch (e) {
      const reason = `실패: 로그인 ID 중복 검사 오류 (${e instanceof Error ? e.message : String(e)})`;
      await writeFailure(spreadsheetId, sheetName, rowNumber, reason);
      out.failedCount++;
      out.results.push({
        rowNumber,
        name,
        phone: maskPhone(phoneRaw),
        loginId: maskLoginId(accountValue),
        result: 'FAILED',
        reason,
      });
      continue;
    }

    // 이름으로 후보 검색
    let candidates;
    try {
      candidates = await searchPersonCandidatesByName(adminDb, name);
    } catch (e) {
      const reason = `실패: Person 검색 오류 (${e instanceof Error ? e.message : String(e)})`;
      await writeFailure(spreadsheetId, sheetName, rowNumber, reason);
      out.failedCount++;
      out.results.push({
        rowNumber,
        name,
        phone: maskPhone(phoneRaw),
        loginId: maskLoginId(accountValue),
        result: 'FAILED',
        reason,
      });
      continue;
    }

    let chosen: typeof candidates[number] | null = null;
    let reason: string | null = null;

    if (candidates.length === 0) {
      reason = '실패: 이름 검색 결과 없음';
    } else if (candidates.length === 1) {
      chosen = candidates[0];
    } else {
      const phoneDigits = normalizePhone(phoneRaw);
      if (!phoneDigits) {
        reason = '실패: 동명이인 - 전화번호 없음';
      } else {
        const phoneMatches = candidates.filter((c) => normalizePhone(c.phone) === phoneDigits);
        if (phoneMatches.length === 0) {
          reason = '실패: 전화번호 일치 후보 없음';
        } else if (phoneMatches.length > 1) {
          reason = '실패: 전화번호 일치 후보 중복';
        } else {
          chosen = phoneMatches[0];
        }
      }
    }

    if (!chosen) {
      const safeReason = reason ?? '실패: 매칭 실패';
      await writeFailure(spreadsheetId, sheetName, rowNumber, safeReason);
      out.failedCount++;
      out.results.push({
        rowNumber,
        name,
        phone: maskPhone(phoneRaw),
        loginId: maskLoginId(accountValue),
        result: 'FAILED',
        reason: safeReason,
      });
      await logMapping(adminDb, {
        action: 'SHEET_SYNC_MATCH_FAILED',
        rowNumber,
        name,
        phone: phoneRaw,
        loginId: accountValue,
        reason: safeReason,
        candidatesCount: candidates.length,
      });
      continue;
    }

    // 발급
    const issued = await issueMappedAccount(adminDb, {
      memberId: chosen.id,
      customerId: chosen.source_customer_id,
      loginCode: accountValue,
      password: accountValue,
      isActive: true,
      matchedBy: 'AUTO_SYNC',
    });

    if (!issued.ok) {
      const issueReason = issued.code === 'DUPLICATE_LOGIN_CODE'
        ? '실패: 로그인 ID 중복'
        : issued.code === 'AUTH_CREATE_FAILED'
          ? `실패: 계정 발급 API 오류 (auth: ${issued.message})`
          : issued.code === 'PROFILE_INSERT_FAILED'
            ? `실패: 계정 발급 API 오류 (profile: ${issued.message})`
            : `실패: 계정 발급 API 오류 (${issued.message})`;
      await writeFailure(spreadsheetId, sheetName, rowNumber, issueReason);
      out.failedCount++;
      out.results.push({
        rowNumber,
        name,
        phone: maskPhone(phoneRaw),
        loginId: maskLoginId(accountValue),
        result: 'FAILED',
        reason: issueReason,
      });
      await logMapping(adminDb, {
        action: 'SHEET_SYNC_ISSUE_FAILED',
        rowNumber,
        name,
        phone: phoneRaw,
        loginId: accountValue,
        personId: chosen.id,
        reason: issueReason,
      });
      continue;
    }

    // 성공 → 시트 갱신 (M='ㅇ', N='')
    try {
      await sheetsSetCell(spreadsheetId, buildRange(sheetName, `M${rowNumber}`), 'ㅇ');
      await sheetsSetCell(spreadsheetId, buildRange(sheetName, `N${rowNumber}`), '');
    } catch (e) {
      // 시트 갱신 실패는 결과 통계에 반영하되 발급 자체는 성공 처리 (멱등 재시도 어려우니 별도 로그)
      // eslint-disable-next-line no-console
      console.warn(`[sheet-sync] 시트 갱신 실패(row ${rowNumber}):`, e);
    }
    out.successCount++;
    out.results.push({
      rowNumber,
      name,
      phone: maskPhone(phoneRaw),
      loginId: maskLoginId(accountValue),
      result: 'SUCCESS',
    });
    await logMapping(adminDb, {
      action: 'SHEET_SYNC_ISSUED',
      rowNumber,
      name,
      phone: phoneRaw,
      loginId: accountValue,
      personId: chosen.id,
      userId: issued.user_id,
      existed: issued.existed,
    });
  }

  return out;
}

async function writeFailure(
  spreadsheetId: string,
  sheetName: string,
  rowNumber: number,
  reason: string,
): Promise<void> {
  try {
    await sheetsSetCell(spreadsheetId, buildRange(sheetName, `M${rowNumber}`), '');
    await sheetsSetCell(spreadsheetId, buildRange(sheetName, `N${rowNumber}`), reason);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[sheet-sync] 실패 사유 기록 실패(row ${rowNumber}):`, e);
  }
}

async function logMapping(
  adminDb: SupabaseClient,
  payload: {
    action: string;
    rowNumber: number;
    name: string;
    phone?: string | null;
    loginId: string;
    personId?: string | null;
    userId?: string | null;
    reason?: string | null;
    existed?: boolean;
    candidatesCount?: number;
  },
): Promise<void> {
  try {
    await adminDb.from('account_mapping_logs').insert({
      action: 'ACCOUNT_ISSUE_SYNC_FROM_GOOGLE_SHEET',
      user_profile_id: payload.userId ?? null,
      member_id: payload.personId ?? null,
      pre_issued_name: payload.name,
      pre_issued_phone: payload.phone ?? null,
      mapping_status: payload.action === 'SHEET_SYNC_ISSUED' ? 'MATCHED' : null,
      matched_by: payload.action === 'SHEET_SYNC_ISSUED' ? 'AUTO_SYNC' : null,
      candidate_type: null,
      reason: payload.reason ?? payload.action,
      admin_id: null,
      metadata: {
        row_number: payload.rowNumber,
        login_id_masked: maskLoginId(payload.loginId),
        existed: payload.existed,
        candidates_count: payload.candidatesCount,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sheet-sync] 감사 로그 기록 실패:', e);
  }
}
