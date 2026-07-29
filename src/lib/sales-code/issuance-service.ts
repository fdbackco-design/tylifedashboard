import type { SupabaseClient } from '@supabase/supabase-js';
import { syncAccountIssueFromGoogleSheet } from '@/lib/account-issue/sheet-sync';
import { sheetsValuesGet, sheetsValuesUpdate } from '@/lib/google/sheets-client';
import {
  buildSalesCodeIssuanceValues,
  formatKstDate,
  formatKstMonthDay,
  normalizeIssuancePhone,
} from '@/lib/sales-code/issuance';

const SHEET_START_ROW = 5;
const FIXED_I_VALUE = '영업 사원';
const FIXED_J_VALUE = '인천광역시 연수구 송도과학로 32 IT센터 S동 3003-3호';

type RequestRow = {
  id: string;
  name: string;
  birth_date: string;
  gender: string;
  phone: string;
  requested_at: string;
  status: string;
  issuance_status: string;
  employee_id: string | null;
  sheet_row_number: number | null;
  processing_started_at: string | null;
  retry_count: number;
};

export type SalesCodeIssuanceItemResult = {
  id: string;
  name: string;
  result: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  stage: 'VALIDATION' | 'SHEET' | 'ACCOUNT_SYNC' | 'COMPLETED';
  reason?: string;
  employeeId?: string;
  sheetRow?: number;
};

export type SalesCodeIssuanceResult = {
  totalCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  results: SalesCodeIssuanceItemResult[];
};

function buildRange(sheetName: string, a1: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!${a1}`;
}

function requestMonthDay(requestedAt: string): string {
  const date = new Date(requestedAt);
  return Number.isNaN(date.getTime()) ? formatKstMonthDay() : formatKstMonthDay(date);
}

async function markFailure(
  db: SupabaseClient,
  row: RequestRow,
  status: 'FAILED' | 'SYNC_FAILED',
  reason: string,
): Promise<void> {
  await db
    .from('sales_code_requests')
    .update({
      issuance_status: status,
      issuance_error: reason.slice(0, 1000),
      retry_count: (row.retry_count ?? 0) + 1,
    })
    .eq('id', row.id);
}

async function claimRequest(
  db: SupabaseClient,
  row: RequestRow,
  admin: { id: string; name: string },
): Promise<boolean> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  let query = db
    .from('sales_code_requests')
    .update({
      issuance_status: 'PROCESSING',
      processing_started_at: now.toISOString(),
      processed_by: admin.id,
      processed_by_name: admin.name,
      issuance_error: null,
    })
    .eq('id', row.id);

  if (row.issuance_status === 'PROCESSING') {
    query = query.lt('processing_started_at', staleCutoff);
  } else {
    query = query.in('issuance_status', ['WAITING', 'EXPORTED', 'FAILED', 'SYNC_FAILED']);
  }
  const { data, error } = await query.select('id');
  return !error && Array.isArray(data) && data.length === 1;
}

async function issueSelectedSalesCodesUnlocked(
  db: SupabaseClient,
  params: {
    ids: readonly string[];
    admin: { id: string; name: string };
    spreadsheetId?: string;
    sheetName?: string;
  },
): Promise<SalesCodeIssuanceResult> {
  const spreadsheetId =
    (params.spreadsheetId ?? process.env.ACCOUNT_ISSUE_SHEET_ID ?? '').trim();
  const sheetName =
    (params.sheetName ?? process.env.ACCOUNT_ISSUE_SHEET_NAME ?? '시트1').trim() || '시트1';
  if (!spreadsheetId) {
    throw new Error('ACCOUNT_ISSUE_SHEET_ID 환경변수가 설정되지 않았습니다.');
  }

  const ids = [...new Set(params.ids)];
  const out: SalesCodeIssuanceResult = {
    totalCount: ids.length,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    results: [],
  };

  const { data, error } = await db
    .from('sales_code_requests')
    .select(
      'id, name, birth_date, gender, phone, requested_at, status, issuance_status, employee_id, sheet_row_number, processing_started_at, retry_count',
    )
    .in('id', ids);
  if (error) throw new Error(`발급 대상 조회 실패: ${error.message}`);

  const byId = new Map(((data ?? []) as RequestRow[]).map((row) => [row.id, row]));
  let sheetRows = await sheetsValuesGet(
    spreadsheetId,
    buildRange(sheetName, `A${SHEET_START_ROW}:O`),
  );
  const reservedRows = new Set<number>();
  const rowsToSync = new Map<number, { row: RequestRow; employeeId: string }>();

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      out.failedCount++;
      out.results.push({
        id,
        name: '',
        result: 'FAILED',
        stage: 'VALIDATION',
        reason: '신청 내역을 찾을 수 없습니다.',
      });
      continue;
    }
    if (row.status === '반려' || row.status === '처리완료' || row.issuance_status === 'COMPLETED') {
      out.skippedCount++;
      out.results.push({
        id: row.id,
        name: row.name,
        result: 'SKIPPED',
        stage: 'COMPLETED',
        reason: '이미 발급 완료되었거나 처리할 수 없는 대상입니다.',
        employeeId: row.employee_id ?? undefined,
        sheetRow: row.sheet_row_number ?? undefined,
      });
      continue;
    }

    let values;
    try {
      values = buildSalesCodeIssuanceValues({
        birthDate: row.birth_date,
        gender: row.gender,
        phone: row.phone,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : '발급 정보 생성 실패';
      await markFailure(db, row, 'FAILED', reason);
      out.failedCount++;
      out.results.push({
        id: row.id,
        name: row.name,
        result: 'FAILED',
        stage: 'VALIDATION',
        reason,
      });
      continue;
    }

    const claimed = await claimRequest(db, row, params.admin);
    if (!claimed) {
      out.skippedCount++;
      out.results.push({
        id: row.id,
        name: row.name,
        result: 'SKIPPED',
        stage: 'VALIDATION',
        reason: '다른 요청에서 처리 중입니다.',
        employeeId: values.employeeId,
      });
      continue;
    }

    const employeeMatches: number[] = [];
    const phoneMatches: number[] = [];
    sheetRows.forEach((sheetRow, index) => {
      const actualRow = SHEET_START_ROW + index;
      if (String(sheetRow?.[6] ?? '').trim().toLowerCase() === values.employeeId.toLowerCase()) {
        employeeMatches.push(actualRow);
      }
      if (normalizeIssuancePhone(String(sheetRow?.[4] ?? '')) === values.phoneDigits) {
        phoneMatches.push(actualRow);
      }
    });

    const storedSheetRowMatches = row.sheet_row_number != null && (() => {
      const stored = sheetRows[row.sheet_row_number! - SHEET_START_ROW] ?? [];
      return (
        String(stored[6] ?? '').trim().toLowerCase() === values.employeeId.toLowerCase() &&
        normalizeIssuancePhone(String(stored[4] ?? '')) === values.phoneDigits &&
        String(stored[1] ?? '').replace(/^\[고객\]\s*/, '').trim() ===
          row.name.replace(/^\[고객\]\s*/, '').trim()
      );
    })();
    const allMatches = new Set([...employeeMatches, ...phoneMatches]);
    const sharedMatch = employeeMatches.find((candidate) => phoneMatches.includes(candidate)) ?? null;
    const sharedRowNameMatches = sharedMatch != null &&
      String(sheetRows[sharedMatch - SHEET_START_ROW]?.[1] ?? '')
        .replace(/^\[고객\]\s*/, '')
        .trim() === row.name.replace(/^\[고객\]\s*/, '').trim();
    let targetRow = storedSheetRowMatches
      ? row.sheet_row_number
      : sharedRowNameMatches ? sharedMatch : null;
    if (
      allMatches.size > 1 ||
      (employeeMatches.length > 0 && sharedMatch == null) ||
      (phoneMatches.length > 0 && sharedMatch == null) ||
      (sharedMatch != null && !sharedRowNameMatches)
    ) {
      const reason = 'Google Sheets 중복 데이터';
      await markFailure(db, row, 'FAILED', reason);
      out.failedCount++;
      out.results.push({
        id: row.id,
        name: row.name,
        result: 'FAILED',
        stage: 'SHEET',
        reason,
        employeeId: values.employeeId,
      });
      continue;
    }

    if (targetRow != null && rowsToSync.has(targetRow)) {
      const reason = '같은 배치에 동일한 사원ID 또는 휴대폰번호 신청이 포함되어 있습니다.';
      await markFailure(db, row, 'FAILED', reason);
      out.failedCount++;
      out.results.push({
        id: row.id,
        name: row.name,
        result: 'FAILED',
        stage: 'SHEET',
        reason,
        employeeId: values.employeeId,
        sheetRow: targetRow,
      });
      continue;
    }

    if (targetRow == null) {
      let index = sheetRows.findIndex((sheetRow, candidateIndex) => {
        const actualRow = SHEET_START_ROW + candidateIndex;
        return (
          !reservedRows.has(actualRow) &&
          String(sheetRow?.[1] ?? '').trim() === '' &&
          String(sheetRow?.[6] ?? '').trim() === ''
        );
      });
      if (index < 0) index = sheetRows.length;
      targetRow = SHEET_START_ROW + index;
      reservedRows.add(targetRow);

      const sheetValues = [[
        row.name,
        row.birth_date.replace(/\D/g, ''),
        row.gender,
        values.formattedPhone,
        requestMonthDay(row.requested_at),
        values.employeeId,
        formatKstDate(),
        FIXED_I_VALUE,
        FIXED_J_VALUE,
        '',
        '',
        '',
      ]];
      try {
        const update = await sheetsValuesUpdate(
          spreadsheetId,
          buildRange(sheetName, `B${targetRow}:M${targetRow}`),
          sheetValues,
        );
        if (update.updatedRows < 1 || update.updatedCells < 1) {
          throw new Error('갱신된 셀이 없습니다.');
        }
        while (sheetRows.length <= index) sheetRows.push([]);
        const localRow = new Array<string>(15).fill('');
        sheetValues[0].forEach((value, valueIndex) => {
          localRow[valueIndex + 1] = value;
        });
        sheetRows[index] = localRow;
      } catch (e) {
        const reason = `Google Sheets 기록 실패: ${e instanceof Error ? e.message : String(e)}`;
        await markFailure(db, row, 'FAILED', reason);
        out.failedCount++;
        out.results.push({
          id: row.id,
          name: row.name,
          result: 'FAILED',
          stage: 'SHEET',
          reason,
          employeeId: values.employeeId,
        });
        continue;
      }
    }

    const writtenAt = new Date().toISOString();
    const { error: markError } = await db
      .from('sales_code_requests')
      .update({
        employee_id: values.employeeId,
        status: '시트등록완료',
        synced_to_sheet: true,
        sheet_synced_at: writtenAt,
        sheet_synced_by: params.admin.name,
        sheet_row_number: targetRow,
        sheet_written_at: writtenAt,
        issuance_status: 'PROCESSING',
        issuance_error: null,
      })
      .eq('id', row.id);
    if (markError) {
      const reason = `시트 기록 후 DB 상태 저장 실패: ${markError.message}`;
      await markFailure(db, row, 'SYNC_FAILED', reason);
      out.failedCount++;
      out.results.push({
        id: row.id,
        name: row.name,
        result: 'FAILED',
        stage: 'SHEET',
        reason,
        employeeId: values.employeeId,
        sheetRow: targetRow,
      });
      continue;
    }
    rowsToSync.set(targetRow, { row, employeeId: values.employeeId });
  }

  if (rowsToSync.size > 0) {
    let syncResults;
    try {
      syncResults = await syncAccountIssueFromGoogleSheet(db, {
        spreadsheetId,
        sheetName,
        rowNumbers: [...rowsToSync.keys()],
      });
    } catch (e) {
      const reason = `계정 동기화 실행 실패: ${e instanceof Error ? e.message : String(e)}`;
      for (const [sheetRow, item] of rowsToSync) {
        await markFailure(db, item.row, 'SYNC_FAILED', reason);
        out.failedCount++;
        out.results.push({
          id: item.row.id,
          name: item.row.name,
          result: 'FAILED',
          stage: 'ACCOUNT_SYNC',
          reason,
          employeeId: item.employeeId,
          sheetRow,
        });
      }
      return out;
    }

    const syncByRow = new Map(syncResults.results.map((result) => [result.rowNumber, result]));
    for (const [sheetRow, item] of rowsToSync) {
      const sync = syncByRow.get(sheetRow);
      const isSuccess =
        sync?.result === 'SUCCESS' ||
        (sync?.result === 'SKIPPED' && String(sync.reason ?? '').includes('이미 처리된 행'));
      if (isSuccess) {
        const completedAt = new Date().toISOString();
        const { error: completeError } = await db
          .from('sales_code_requests')
          .update({
            status: '처리완료',
            issuance_status: 'COMPLETED',
            completed_at: completedAt,
            account_synced_at: completedAt,
            issuance_error: null,
          })
          .eq('id', item.row.id);
        if (completeError) {
          const reason = `계정 동기화 후 DB 상태 저장 실패: ${completeError.message}`;
          await markFailure(db, item.row, 'SYNC_FAILED', reason);
          out.failedCount++;
          out.results.push({
            id: item.row.id,
            name: item.row.name,
            result: 'FAILED',
            stage: 'ACCOUNT_SYNC',
            reason,
            employeeId: item.employeeId,
            sheetRow,
          });
        } else {
          out.successCount++;
          out.results.push({
            id: item.row.id,
            name: item.row.name,
            result: 'SUCCESS',
            stage: 'COMPLETED',
            employeeId: item.employeeId,
            sheetRow,
          });
        }
      } else {
        const reason = sync?.reason ?? '계정 동기화 결과를 확인할 수 없습니다.';
        await markFailure(db, item.row, 'SYNC_FAILED', reason);
        out.failedCount++;
        out.results.push({
          id: item.row.id,
          name: item.row.name,
          result: 'FAILED',
          stage: 'ACCOUNT_SYNC',
          reason,
          employeeId: item.employeeId,
          sheetRow,
        });
      }
    }
  }

  return out;
}

export async function issueSelectedSalesCodes(
  db: SupabaseClient,
  params: {
    ids: readonly string[];
    admin: { id: string; name: string };
    spreadsheetId?: string;
    sheetName?: string;
  },
): Promise<SalesCodeIssuanceResult> {
  const lockKey = 'account-issue-google-sheet';
  const ownerToken = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  await db
    .from('sales_code_issuance_locks')
    .delete()
    .eq('lock_key', lockKey)
    .lt('acquired_at', staleBefore);
  const { error: lockError } = await db.from('sales_code_issuance_locks').insert({
    lock_key: lockKey,
    owner_token: ownerToken,
    acquired_at: new Date().toISOString(),
  });
  if (lockError) {
    if (lockError.code === '23505') {
      throw new Error('다른 관리자가 발급 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
    }
    throw new Error(`발급 처리 잠금 실패: ${lockError.message}`);
  }

  try {
    return await issueSelectedSalesCodesUnlocked(db, params);
  } finally {
    await db
      .from('sales_code_issuance_locks')
      .delete()
      .eq('lock_key', lockKey)
      .eq('owner_token', ownerToken);
  }
}
