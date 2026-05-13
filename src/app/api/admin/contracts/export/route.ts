import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import ExcelJS from 'exceljs';

type ContractExportRow = {
  id: string;
  sequence_no: number | null;
  contract_code: string | null;
  join_date: string | null;
  item_name: string | null;
  rental_request_no: string | null;
  invoice_no: string | null;
  memo: string | null;
  unit_count: number | null;
  join_method: string | null;
  status: string | null;
  is_cancelled: boolean | null;
  affiliation_name: string | null;
  sales_link_status: string | null;
  raw_sales_member_name: string | null;
  customers: { name: string | null } | null;
  sales_member: { name: string | null } | null;
};

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const db = createAdminSupabaseClient();

  // 전체 계약 export: 양이 많을 수 있으므로 page 단위로 끊어서 수집한다.
  const PAGE_SIZE = 2000;
  const all: ContractExportRow[] = [];

  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('contracts')
      .select(
        `
        id,
        sequence_no,
        contract_code,
        join_date,
        item_name,
        rental_request_no,
        invoice_no,
        memo,
        unit_count,
        join_method,
        status,
        is_cancelled,
        affiliation_name,
        sales_link_status,
        raw_sales_member_name,
        customers(name),
        sales_member:organization_members!contracts_sales_member_id_fkey(name)
        `,
      )
      .order('sequence_no', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as ContractExportRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'TY Life Dashboard';
  wb.created = new Date();

  const ws = wb.addWorksheet('contracts');
  ws.columns = [
    { header: '순번', key: 'sequence_no', width: 10 },
    { header: '가입일', key: 'join_date', width: 12 },
    { header: '고객명', key: 'customer_name', width: 18 },
    { header: '소속', key: 'affiliation_name', width: 16 },
    { header: '담당사원(확정)', key: 'sales_member_name', width: 16 },
    { header: '담당사원(원본)', key: 'raw_sales_member_name', width: 16 },
    { header: '매핑상태', key: 'sales_link_status', width: 14 },
    { header: '계약코드', key: 'contract_code', width: 16 },
    { header: '물품명', key: 'item_name', width: 24 },
    { header: '구좌수', key: 'unit_count', width: 10 },
    { header: '가입방법', key: 'join_method', width: 12 },
    { header: '상태', key: 'status', width: 10 },
    { header: '취소반품', key: 'is_cancelled', width: 10 },
    { header: '렌탈신청번호', key: 'rental_request_no', width: 18 },
    { header: '송장번호', key: 'invoice_no', width: 16 },
    { header: '메모', key: 'memo', width: 32 },
    { header: 'contract_id', key: 'id', width: 38 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const r of all) {
    ws.addRow({
      sequence_no: r.sequence_no ?? '',
      join_date: r.join_date ? String(r.join_date).slice(0, 10) : '',
      customer_name: r.customers?.name ?? '',
      affiliation_name: r.affiliation_name ?? '',
      sales_member_name: r.sales_member?.name ?? '',
      raw_sales_member_name: r.raw_sales_member_name ?? '',
      sales_link_status: r.sales_link_status ?? '',
      contract_code: r.contract_code ?? '',
      item_name: r.item_name ?? '',
      unit_count: r.unit_count ?? 0,
      join_method: r.join_method ?? '',
      status: r.status ?? '',
      is_cancelled: r.is_cancelled ? 'Y' : '',
      rental_request_no: r.rental_request_no ?? '',
      invoice_no: r.invoice_no ?? '',
      memo: r.memo ?? '',
      id: r.id,
    });
  }

  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const filename = `contracts_${formatDate(new Date())}.xlsx`;

  return new NextResponse(Buffer.from(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=\"${filename}\"`,
      // 다운로드 응답은 캐시하지 않음
      'Cache-Control': 'no-store',
    },
  });
}

