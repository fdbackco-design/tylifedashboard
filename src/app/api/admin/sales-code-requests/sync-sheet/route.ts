/**
 * POST /api/admin/sales-code-requests/sync-sheet
 *
 * 선택된 신청 내역을 구글 시트에 동기화한다.
 *
 * body: { ids: string[] }
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
 * 후처리:
 *   - 성공한 row 의 status = '시트등록완료', synced_to_sheet = true, sheet_synced_at = now()
 *   - 이미 synced_to_sheet=true 인 항목은 중복 동기화 금지
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return jsonNoStore({ error: 'unauthorized' }, { status: 401 });
  }
  let body: { ids?: unknown; changed_by?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ error: 'JSON body 필요' }, { status: 400 });
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
    return jsonNoStore({ error: '동기화할 항목을 선택하세요' }, { status: 400 });
  }
  if (ids.length > 500) {
    return jsonNoStore({ error: '한 번에 최대 500건' }, { status: 400 });
  }
  const changedBy = (typeof body.changed_by === 'string' ? body.changed_by.trim() : '') || 'admin';

  const db = createAdminSupabaseClient();

  // 대상 row 조회 + 이미 동기화된 항목은 제외
  const { data: rows, error: rErr } = await db
    .from('sales_code_requests')
    .select(
      'id, name, birth_date, gender, phone, synced_to_sheet, status',
    )
    .in('id', ids);
  if (rErr) return jsonNoStore({ error: rErr.message }, { status: 500 });

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
      total_requested: ids.length,
      success_count: 0,
      skipped_count: skipped,
      message: '동기화할 신규 항목이 없습니다(이미 동기화됨).',
    });
  }

  // 시트에서 B열/C열 전체를 읽어 "둘 다 빈" 첫 행 번호 결정
  // 충분한 범위 확보를 위해 B1:C2000 까지 조회
  let firstEmptyRow = 1;
  let scannedRows = 0;
  try {
    const bc = await sheetsValuesGet(SPREADSHEET_ID, `${SHEET_REF}!B1:C2000`);
    scannedRows = bc.length;
    let found = -1;
    for (let i = 0; i < bc.length; i++) {
      const r = bc[i] ?? [];
      const b = (r[0] ?? '').toString().trim();
      const c = (r[1] ?? '').toString().trim();
      if (b === '' && c === '') {
        found = i + 1;
        break;
      }
    }
    firstEmptyRow = found > 0 ? found : bc.length + 1;
    if (firstEmptyRow < 1) firstEmptyRow = 1;
  } catch (e) {
    return jsonNoStore(
      { error: `구글 시트 조회 실패: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  const todayMMDD = fmtTodayMMDD();
  // B~J 9개 열로 모은 row 구성
  const sheetRows: string[][] = targets.map((r) => [
    r.name,            // B
    (r.birth_date ?? '').replace(/\D/g, ''), // C: YYYYMMDD 8자리 그대로
    r.gender,          // D
    r.phone,           // E
    todayMMDD,         // F
    '',                // G
    '',                // H
    FIXED_I_VALUE,     // I
    FIXED_J_VALUE,     // J
  ]);

  const startRow = firstEmptyRow;
  const endRow = firstEmptyRow + sheetRows.length - 1;
  const range = `${SHEET_REF}!B${startRow}:J${endRow}`;
  let updateMeta: {
    updatedRange: string;
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
  } = { updatedRange: '', updatedRows: 0, updatedColumns: 0, updatedCells: 0 };
  try {
    updateMeta = await sheetsValuesUpdate(SPREADSHEET_ID, range, sheetRows);
  } catch (e) {
    return jsonNoStore(
      { error: `구글 시트 업데이트 실패: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // 구글이 실제로 갱신한 셀이 0이면 시트에 안 써진 상태이므로 DB 마킹도 하지 않는다.
  if (updateMeta.updatedCells <= 0) {
    return jsonNoStore(
      {
        error:
          '구글 시트가 응답은 했지만 갱신된 셀이 0건입니다. 시트 이름/권한/탭(시트1) 존재 여부를 확인하세요.',
        scanned_rows: scannedRows,
        first_empty_row: firstEmptyRow,
        attempted_range: range,
        updated: updateMeta,
      },
      { status: 502 },
    );
  }

  // DB 후처리: 동기화 완료 마킹
  const nowIso = new Date().toISOString();
  const { error: uErr } = await db
    .from('sales_code_requests')
    .update({
      status: '시트등록완료',
      synced_to_sheet: true,
      sheet_synced_at: nowIso,
      sheet_synced_by: changedBy,
    })
    .in(
      'id',
      targets.map((t) => t.id),
    );
  if (uErr) {
    // 시트는 이미 갱신됨. DB 마킹만 실패한 경우 분리하여 알린다.
    return jsonNoStore(
      {
        error: `시트 입력은 성공했으나 DB 마킹 실패: ${uErr.message}`,
        success_count: targets.length,
        skipped_count: skipped,
        range,
      },
      { status: 207 },
    );
  }

  return jsonNoStore({
    total_requested: ids.length,
    success_count: targets.length,
    skipped_count: skipped,
    scanned_rows: scannedRows,
    first_empty_row: firstEmptyRow,
    attempted_range: range,
    updated: updateMeta,
    sheet_synced_at: nowIso,
  });
}
