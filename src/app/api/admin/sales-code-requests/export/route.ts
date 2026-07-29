import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { buildSalesCodeIssuanceValues, formatKstDate } from '@/lib/sales-code/issuance';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type ExportRow = {
  id: string;
  name: string;
  birth_date: string;
  gender: string;
  phone: string;
  status: string;
  issuance_status: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'JSON body 필요' }, { status: 400 });
  }
  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter((value) => UUID.test(value)),
    ),
  ];
  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: '다운로드할 항목을 선택하세요.' }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ success: false, error: '한 번에 최대 500건까지 다운로드할 수 있습니다.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from('sales_code_requests')
    .select('id, name, birth_date, gender, phone, status, issuance_status')
    .in('id', ids);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const byId = new Map(((data ?? []) as ExportRow[]).map((row) => [row.id, row]));
  const rows = ids.map((id) => byId.get(id)).filter((row): row is ExportRow => Boolean(row));
  const unavailable = rows.filter(
    (row) =>
      row.status === '반려' ||
      row.status === '처리완료' ||
      row.issuance_status === 'PROCESSING' ||
      row.issuance_status === 'COMPLETED' ||
      row.issuance_status === 'SYNC_FAILED',
  );
  if (rows.length !== ids.length || unavailable.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: '이미 발급 완료되었거나 처리할 수 없는 대상이 포함되어 있습니다.',
        unavailable: unavailable.map((row) => ({ id: row.id, name: row.name })),
      },
      { status: 409 },
    );
  }

  const prepared: Array<{
    row: ExportRow;
    employeeId: string;
    residentNumber: string;
    formattedPhone: string;
    phoneDigits: string;
  }> = [];
  const invalid: Array<{ id: string; name: string; reason: string }> = [];
  for (const row of rows) {
    try {
      const values = buildSalesCodeIssuanceValues({
        birthDate: row.birth_date,
        gender: row.gender,
        phone: row.phone,
      });
      prepared.push({
        row,
        employeeId: values.employeeId,
        residentNumber: values.residentNumber,
        formattedPhone: values.formattedPhone,
        phoneDigits: values.phoneDigits,
      });
    } catch (e) {
      invalid.push({
        id: row.id,
        name: row.name,
        reason: e instanceof Error ? e.message : '발급 정보 생성 실패',
      });
    }
  }
  if (invalid.length > 0) {
    return NextResponse.json(
      { success: false, error: '발급 정보가 올바르지 않은 대상이 있습니다.', invalid },
      { status: 422 },
    );
  }

  const employeeCounts = new Map<string, number>();
  const phoneCounts = new Map<string, number>();
  for (const item of prepared) {
    employeeCounts.set(item.employeeId, (employeeCounts.get(item.employeeId) ?? 0) + 1);
    phoneCounts.set(item.phoneDigits, (phoneCounts.get(item.phoneDigits) ?? 0) + 1);
  }
  const employeeIds = [...employeeCounts.keys()];
  const [{ data: existingProfiles, error: profileError }, { data: existingRequests, error: requestError }] =
    await Promise.all([
      db.from('user_profiles').select('id, login_code').in('login_code', employeeIds),
      db
        .from('sales_code_requests')
        .select('id, employee_id')
        .in('employee_id', employeeIds),
    ]);
  if (profileError || requestError) {
    return NextResponse.json(
      {
        success: false,
        error: `사원ID 중복 확인 실패: ${profileError?.message ?? requestError?.message}`,
      },
      { status: 500 },
    );
  }
  const issuedIds = new Set(
    ((existingProfiles ?? []) as Array<{ login_code: string }>).map((row) => row.login_code),
  );
  const requestIdsByEmployee = new Map<string, Set<string>>();
  for (const existing of (existingRequests ?? []) as Array<{ id: string; employee_id: string }>) {
    const requestIds = requestIdsByEmployee.get(existing.employee_id) ?? new Set<string>();
    requestIds.add(existing.id);
    requestIdsByEmployee.set(existing.employee_id, requestIds);
  }
  const conflicts = prepared
    .filter((item) => {
      const hasOtherRequest = [...(requestIdsByEmployee.get(item.employeeId) ?? [])]
        .some((requestId) => requestId !== item.row.id);
      return (
        (employeeCounts.get(item.employeeId) ?? 0) > 1 ||
        (phoneCounts.get(item.phoneDigits) ?? 0) > 1 ||
        issuedIds.has(item.employeeId) ||
        hasOtherRequest
      );
    })
    .map((item) => ({
      id: item.row.id,
      name: item.row.name,
      reason: '같은 사원ID 또는 휴대폰번호가 이미 발급되었거나 선택 목록에 중복되어 있습니다.',
    }));
  if (conflicts.length > 0) {
    return NextResponse.json(
      { success: false, error: '중복 발급 대상이 포함되어 있습니다.', invalid: conflicts },
      { status: 409 },
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TY Life Dashboard';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('영업자 코드 발급');
  worksheet.columns = [
    { header: '이름', key: 'name', width: 18 },
    { header: '사원ID', key: 'employee_id', width: 18 },
    { header: '주민등록번호', key: 'resident_number', width: 20 },
    { header: '휴대폰', key: 'phone', width: 18 },
  ];
  worksheet.getRow(1).font = { bold: false };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const item of prepared) {
    worksheet.addRow({
      name: item.row.name,
      employee_id: item.employeeId,
      resident_number: item.residentNumber,
      phone: item.formattedPhone,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const now = new Date().toISOString();
  const updates = await Promise.all(
    prepared.map((item) =>
      db
        .from('sales_code_requests')
        .update({
          employee_id: item.employeeId,
          issuance_status: 'EXPORTED',
          excel_downloaded_at: now,
          issuance_error: null,
        })
        .eq('id', item.row.id)
        .in('issuance_status', ['WAITING', 'EXPORTED', 'FAILED']),
    ),
  );
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) {
    return NextResponse.json(
      { success: false, error: `엑셀 생성 후 상태 저장 실패: ${updateError.message}` },
      { status: 500 },
    );
  }

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sales_code_${formatKstDate().replace(/-/g, '')}.xlsx"`,
      'Cache-Control': 'no-store',
      'X-Exported-Count': String(prepared.length),
    },
  });
}
