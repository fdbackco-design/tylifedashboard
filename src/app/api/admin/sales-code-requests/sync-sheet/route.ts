/**
 * POST /api/admin/sales-code-requests/sync-sheet
 *
 * 선택된 신청 내역을 구글 시트에 동기화한다.
 *
 * body: { ids: string[], changed_by?: string }
 * query: ?debug=1  → 정상 흐름 로그도 출력 (production 기본은 에러만 출력)
 *
 * 시트:
 *   https://docs.google.com/spreadsheets/d/1zqNSyKn6fnCE2ABiPOTUPfPPZiYLxtr4TCndlJ70v6o
 *   탭: '시트1'
 *
 * 입력 규칙:
 *   - "B열과 C열이 모두 비어 있는 첫 번째 행"부터 차례로 입력
 *   - 열 매핑
 *       B: name             (이름)
 *       C: birth_date       (YYYYMMDD 8자리 문자열 그대로)
 *       D: gender           (남/여)
 *       E: phone            (010-1234-1234)
 *       F: 요청날짜          (오늘 MM-DD)
 *       I: 영업 사원          (고정)
 *       J: 인천광역시 ...    (고정 주소)
 *
 * 후처리 원칙(매우 중요):
 *   - Google Sheets 응답의 updatedCells > 0 이 확인된 경우에만 DB status='시트등록완료'.
 *   - 시트 write 가 실패하거나 갱신 셀이 0 이면 DB 상태는 절대 바꾸지 않는다.
 *   - DB 마킹 단계만 실패한 경우 207(부분 성공) 로 분리해서 응답한다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { sheetsValuesGet, sheetsValuesUpdate } from '@/lib/google/sheets-client';

// 외부 Google Sheets 호출(조회+업데이트) + Supabase 업데이트가 직렬로 일어나므로
// 기본 timeout(10s) 안에 끝나지 않을 수 있다. nodejs runtime + 60s 까지 허용한다.
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body as any, init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

const SPREADSHEET_ID = '1zqNSyKn6fnCE2ABiPOTUPfPPZiYLxtr4TCndlJ70v6o';
const SHEET_NAME = '시트1';
/**
 * 영업자 코드 발급 시트의 실제 데이터 입력 시작 행.
 * 시트 상단 1~3 행은 헤더/안내 영역이라 절대 덮어쓰지 않는다.
 * 빈 행 탐색과 write target row 계산은 모두 이 상수를 기준으로 한다.
 */
const SALES_CODE_SHEET_START_ROW = 4;
const FIXED_I_VALUE = '영업 사원';
const FIXED_J_VALUE = '인천광역시 연수구 송도과학로 32 IT센터 S동 3003-3호';

/** A1 표기 안전화: 한글/공백/특수문자가 있는 시트명은 항상 single-quote 로 감싼다. */
function sheetRef(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}
const SHEET_REF = sheetRef(SHEET_NAME);

function fmtTodayMMDD(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const mm = parts.find((p) => p.type === 'month')?.value ?? '';
  const dd = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${mm}-${dd}`;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 8자리 YYYYMMDD 만 살리고 그 외 문자는 제거 + 길이 검증. */
function toYmd8(input: string | null | undefined): string {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length === 8 ? digits : digits;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return jsonNoStore({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const debugParam = new URL(req.url).searchParams.get('debug') === '1';
  const isDev = process.env.NODE_ENV !== 'production';
  const verbose = isDev || debugParam;
  const logVerbose = (label: string, payload: unknown): void => {
    if (!verbose) return;
    // eslint-disable-next-line no-console
    console.log(`[sales-code-sheet-sync:${label}]`, payload);
  };
  const logError = (label: string, payload: unknown): void => {
    // eslint-disable-next-line no-console
    console.error(`[sales-code-sheet-sync:${label}]`, payload);
  };

  let body: { ids?: unknown; changed_by?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ ok: false, error: 'JSON body 필요' }, { status: 400 });
  }
  const idsRaw = Array.isArray(body.ids) ? body.ids : [];
  const ids = [
    ...new Set(
      idsRaw
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((s) => UUID.test(s)),
    ),
  ];
  if (ids.length === 0) {
    return jsonNoStore({ ok: false, error: '동기화할 항목을 선택하세요' }, { status: 400 });
  }
  if (ids.length > 500) {
    return jsonNoStore({ ok: false, error: '한 번에 최대 500건' }, { status: 400 });
  }
  const changedBy = (typeof body.changed_by === 'string' ? body.changed_by.trim() : '') || 'admin';

  logVerbose('start', {
    requestIds: ids,
    count: ids.length,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
  });

  const db = createAdminSupabaseClient();

  // 대상 row 조회 + 이미 동기화된 항목은 제외
  const { data: rows, error: rErr } = await db
    .from('sales_code_requests')
    .select('id, name, birth_date, gender, phone, synced_to_sheet, status')
    .in('id', ids);
  if (rErr) {
    logError('error', {
      stage: 'select_targets',
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      message: rErr.message,
    });
    return jsonNoStore({ ok: false, error: rErr.message, failedRequestIds: ids }, { status: 500 });
  }

  type Row = {
    id: string;
    name: string;
    birth_date: string;
    gender: string;
    phone: string;
    synced_to_sheet: boolean;
    status: string;
  };
  const targets: Row[] = ((rows ?? []) as Row[]).filter((r) => !r.synced_to_sheet);
  const skipped = ((rows ?? []) as Row[]).length - targets.length;

  if (targets.length === 0) {
    return jsonNoStore({
      ok: true,
      total_requested: ids.length,
      success_count: 0,
      skipped_count: skipped,
      successRequestIds: [],
      failedRequestIds: [],
      message: '동기화할 신규 항목이 없습니다(이미 동기화됨).',
    });
  }

  // 시트에서 B열/C열의 데이터 영역을 읽어 "둘 다 빈" 첫 행 번호 결정.
  // 입력은 SALES_CODE_SHEET_START_ROW(=4) 부터 시작하므로 그 위 영역(1~3행 헤더)은
  // 절대 스캔/덮어쓰지 않는다. 충분한 범위 확보를 위해 B{start}:C2000 까지 조회.
  let firstEmptyRow = SALES_CODE_SHEET_START_ROW;
  let scannedRows = 0;
  const scannedRange = `${SHEET_REF}!B${SALES_CODE_SHEET_START_ROW}:C2000`;
  try {
    const bc = await sheetsValuesGet(SPREADSHEET_ID, scannedRange);
    scannedRows = bc.length;
    const relativeIndex = bc.findIndex((row) => {
      const r = row ?? [];
      const b = (r[0] ?? '').toString().trim();
      const c = (r[1] ?? '').toString().trim();
      return b === '' && c === '';
    });
    firstEmptyRow =
      relativeIndex >= 0
        ? SALES_CODE_SHEET_START_ROW + relativeIndex
        : SALES_CODE_SHEET_START_ROW + bc.length;
    if (firstEmptyRow < SALES_CODE_SHEET_START_ROW) firstEmptyRow = SALES_CODE_SHEET_START_ROW;
    logVerbose('empty-row', {
      sheetName: SHEET_NAME,
      startRow: SALES_CODE_SHEET_START_ROW,
      scannedRange,
      scannedRows,
      nextRow: firstEmptyRow,
    });
  } catch (e) {
    const err = e as Error;
    logError('error', {
      stage: 'sheets_values_get',
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      range: scannedRange,
      message: err.message,
      stack: err.stack,
    });
    return jsonNoStore(
      {
        ok: false,
        message: 'Google Sheet 조회에 실패했습니다.',
        error: `구글 시트 조회 실패: ${err.message}`,
        failedRequestIds: targets.map((t) => t.id),
      },
      { status: 502 },
    );
  }

  const todayMMDD = fmtTodayMMDD();
  // B~J 9개 열로 모은 row 구성
  const sheetRows: string[][] = targets.map((r) => [
    r.name,                   // B
    toYmd8(r.birth_date),     // C: YYYYMMDD 8자리 그대로
    r.gender,                 // D
    r.phone,                  // E
    todayMMDD,                // F
    '',                       // G
    '',                       // H
    FIXED_I_VALUE,            // I
    FIXED_J_VALUE,            // J
  ]);

  const startRow = firstEmptyRow;
  const endRow = firstEmptyRow + sheetRows.length - 1;
  const range = `${SHEET_REF}!B${startRow}:J${endRow}`;

  // 행 단위 상세 로그 (요청 추적용)
  targets.forEach((r, idx) => {
    const targetRow = startRow + idx;
    logVerbose('target-row', {
      requestId: r.id,
      name: r.name,
      birthDate: toYmd8(r.birth_date),
      gender: r.gender,
      phone: r.phone,
      targetRow,
      range: `${SHEET_REF}!B${targetRow}:J${targetRow}`,
      values: sheetRows[idx],
    });
  });

  let updateMeta: {
    updatedRange: string;
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
  } = { updatedRange: '', updatedRows: 0, updatedColumns: 0, updatedCells: 0 };
  try {
    updateMeta = await sheetsValuesUpdate(SPREADSHEET_ID, range, sheetRows);
  } catch (e) {
    const err = e as Error;
    logError('error', {
      stage: 'sheets_values_update',
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      range,
      message: err.message,
      stack: err.stack,
      requestIds: targets.map((t) => t.id),
    });
    return jsonNoStore(
      {
        ok: false,
        message: 'Google Sheet 동기화에 실패했습니다.',
        error: `구글 시트 업데이트 실패: ${err.message}`,
        spreadsheetId: SPREADSHEET_ID,
        sheetName: SHEET_NAME,
        range,
        failedRequestIds: targets.map((t) => t.id),
      },
      { status: 502 },
    );
  }

  // 행 단위 write-result 로그 (요청 ↔ 시트 row 매핑 확인용)
  targets.forEach((r, idx) => {
    const targetRow = startRow + idx;
    const cellsThisRow = updateMeta.updatedCells > 0 ? Math.min(9, updateMeta.updatedCells) : 0;
    logVerbose('write-result', {
      requestId: r.id,
      range: `${SHEET_REF}!B${targetRow}:J${targetRow}`,
      updatedRange: updateMeta.updatedRange,
      updatedRows: updateMeta.updatedRows,
      updatedColumns: updateMeta.updatedColumns,
      updatedCells: updateMeta.updatedCells,
      cellsThisRowEstimate: cellsThisRow,
    });
  });

  // 구글이 실제로 갱신한 셀이 0 이면 시트에 안 써진 상태이므로 DB 마킹도 하지 않는다.
  // (updatedCells > 0 + updatedRows > 0 둘 다 만족할 때만 성공으로 본다.)
  const sheetWriteOk = updateMeta.updatedCells > 0 && updateMeta.updatedRows > 0;
  if (!sheetWriteOk) {
    logError('error', {
      stage: 'sheets_values_update_zero',
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      range,
      updated: updateMeta,
      requestIds: targets.map((t) => t.id),
      message:
        '구글 시트가 응답은 했으나 updatedCells/updatedRows 가 0 입니다. 시트 이름/권한/탭(시트1) 존재 여부를 확인하세요.',
    });
    return jsonNoStore(
      {
        ok: false,
        message: 'Google Sheet 동기화에 실패했습니다.',
        error:
          '구글 시트가 응답은 했지만 갱신된 셀이 0건입니다. 시트 이름/권한/탭(시트1) 존재 여부를 확인하세요.',
        spreadsheetId: SPREADSHEET_ID,
        sheetName: SHEET_NAME,
        scanned_rows: scannedRows,
        first_empty_row: firstEmptyRow,
        attempted_range: range,
        updated: updateMeta,
        failedRequestIds: targets.map((t) => t.id),
      },
      { status: 502 },
    );
  }

  // DB 후처리: 동기화 완료 마킹 (시트 write 성공이 확인된 경우에만 실행)
  const nowIso = new Date().toISOString();
  const targetIds = targets.map((t) => t.id);
  const { error: uErr } = await db
    .from('sales_code_requests')
    .update({
      status: '시트등록완료',
      synced_to_sheet: true,
      sheet_synced_at: nowIso,
      sheet_synced_by: changedBy,
    })
    .in('id', targetIds);
  if (uErr) {
    // 시트는 이미 갱신됨 → 화면에는 부분 실패(207) 로 분명히 알린다.
    logError('error', {
      stage: 'db_mark',
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      range,
      message: uErr.message,
      requestIds: targetIds,
    });
    return jsonNoStore(
      {
        ok: false,
        message: '시트 입력은 성공했으나 DB 마킹에 실패했습니다.',
        error: `시트 입력은 성공했으나 DB 마킹 실패: ${uErr.message}`,
        spreadsheetId: SPREADSHEET_ID,
        sheetName: SHEET_NAME,
        success_count: 0,
        skipped_count: skipped,
        range,
        successRequestIds: [],
        failedRequestIds: targetIds,
      },
      { status: 207 },
    );
  }

  return jsonNoStore({
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    total_requested: ids.length,
    success_count: targets.length,
    skipped_count: skipped,
    scanned_rows: scannedRows,
    first_empty_row: firstEmptyRow,
    attempted_range: range,
    updated: updateMeta,
    sheet_synced_at: nowIso,
    successRequestIds: targetIds,
    failedRequestIds: [],
  });
}
