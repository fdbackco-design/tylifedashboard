import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  parseHeadquartersSettlementFiles,
  type HeadquartersSettlementExcelRow,
} from '@/lib/settlement/reconciliation-excel';
import {
  reconcileHeadquartersSettlements,
  type ReconciliationContractMeta,
  type ReconciliationSystemLine,
} from '@/lib/settlement/reconciliation';
import type { SettlementCalculationDetail } from '@/lib/types/settlement';
import { getContractDisplayProductName } from '@/lib/utils/contract-display-product';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_FILES = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DB_CHUNK_SIZE = 200;

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function cleanMemberName(value: unknown): string {
  return String(value ?? '').replace(/^\[고객\]\s*/, '').trim();
}

type RawSystemLine = Omit<ReconciliationSystemLine, 'recipientName' | 'effectiveOwnerName'> & {
  effectiveOwnerMemberId: string | null;
  effectiveOwnerNameHint: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'multipart/form-data 형식이 필요합니다.' }, { status: 400 });
  }

  const yearMonth = String(formData.get('year_month') ?? '').trim();
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: '정산월 형식은 YYYY-MM이어야 합니다.' }, { status: 400 });
  }

  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ error: '엑셀 파일을 1개 이상 선택해 주세요.' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `파일은 최대 ${MAX_FILES}개까지 업로드할 수 있습니다.` }, { status: 400 });
  }
  for (const file of files) {
    if (!/\.xlsx$/i.test(file.name)) {
      return NextResponse.json({ error: `${file.name}: .xlsx 파일만 지원합니다.` }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${file.name}: 파일 크기는 20MB 이하여야 합니다.` }, { status: 400 });
    }
  }

  let excelRows: HeadquartersSettlementExcelRow[];
  let warnings: string[];
  try {
    const parsed = await parseHeadquartersSettlementFiles(
      await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          buffer: await file.arrayBuffer(),
        })),
      ),
      yearMonth,
    );
    excelRows = parsed.rows;
    warnings = parsed.warnings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `엑셀 파싱 실패: ${message}` }, { status: 400 });
  }
  if (excelRows.length === 0) {
    return NextResponse.json(
      { error: `${yearMonth}에 해당하는 계약 행을 찾지 못했습니다.`, warnings },
      { status: 400 },
    );
  }

  const db = createAdminSupabaseClient();
  const [settlementsRes, clawbacksRes] = await Promise.all([
    db
      .from('monthly_settlements')
      .select('member_id, base_commission, rollup_commission, care_plan_commission, calculation_detail')
      .eq('year_month', yearMonth),
    db
      .from('settlement_clawback_entries')
      .select('contract_code, contract_id, recipient_member_id, amount_type, amount_won, internal_exempt')
      .eq('clawback_year_month', yearMonth)
      .eq('internal_exempt', false),
  ]);
  if (settlementsRes.error) {
    return NextResponse.json({ error: settlementsRes.error.message }, { status: 500 });
  }
  if (clawbacksRes.error) {
    return NextResponse.json({ error: clawbacksRes.error.message }, { status: 500 });
  }

  const rawLines: RawSystemLine[] = [];
  for (const settlement of settlementsRes.data ?? []) {
    const detail = settlement.calculation_detail as SettlementCalculationDetail | null;
    const recipientMemberId = String(settlement.member_id);
    if (!detail) continue;

    for (const line of detail.direct_contracts ?? []) {
      rawLines.push({
        contractCode: String(line.contract_code ?? '').trim(),
        contractId: line.contract_id ? String(line.contract_id) : null,
        recipientMemberId,
        effectiveOwnerMemberId: null,
        effectiveOwnerNameHint: '',
        amount: Math.round(Number(line.subtotal) || 0),
        payoutType: '개인수당',
        unitCount: Number(line.unit_count) || 0,
      });
    }

    for (const line of detail.rollup_contract_items ?? []) {
      rawLines.push({
        contractCode: String(line.contract_code ?? '').trim(),
        contractId: line.contract_id ? String(line.contract_id) : null,
        recipientMemberId,
        effectiveOwnerMemberId: line.effective_sales_member_id
          ? String(line.effective_sales_member_id)
          : null,
        effectiveOwnerNameHint: cleanMemberName(line.effective_sales_member_name),
        amount: Math.round(Number(line.subtotal) || 0),
        payoutType: '롤업수당',
        unitCount: Number(line.unit_count) || 0,
        organizationPath: line.org_path_label ?? null,
        upperRank: line.upper_rank_applied ?? detail.rank ?? null,
        lowerRank: line.effective_sales_member_rank ?? line.from_rank ?? null,
        upperUnitPrice: line.upper_direct_commission_per_unit ?? null,
        lowerUnitPrice: line.lower_direct_commission_per_unit ?? null,
        rollupUnitPrice: line.rollup_amount_per_unit ?? null,
      });
    }

    for (const line of detail.care_plan_commission_lines ?? []) {
      if (line.payment_status !== 'pending' && line.payment_status !== 'paid') continue;
      rawLines.push({
        contractCode: String(line.contract_code ?? '').trim(),
        contractId: line.contract_id ? String(line.contract_id) : null,
        recipientMemberId,
        effectiveOwnerMemberId: recipientMemberId,
        effectiveOwnerNameHint: '',
        amount: Math.round(Number(line.amount_won) || 0),
        payoutType: '케어플랜수당',
        unitCount: Number(line.unit_count) || 0,
      });
    }
  }

  for (const line of clawbacksRes.data ?? []) {
    rawLines.push({
      contractCode: String(line.contract_code ?? '').trim(),
      contractId: line.contract_id ? String(line.contract_id) : null,
      recipientMemberId: String(line.recipient_member_id),
      effectiveOwnerMemberId: null,
      effectiveOwnerNameHint: '',
      amount: -Math.abs(Math.round(Number(line.amount_won) || 0)),
      payoutType: '환수금',
      unitCount: 0,
    });
  }

  const contractCodes = [
    ...new Set(
      [...excelRows.map((row) => row.contractCode), ...rawLines.map((line) => line.contractCode)].filter(Boolean),
    ),
  ];
  const contractRows: any[] = [];
  for (const codeChunk of chunks(contractCodes, DB_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('contracts')
      .select(
        'id, contract_code, product_type, item_name, source_snapshot_json, sales_member_id, settlement_sales_member_id, customers(name)',
      )
      .in('contract_code', codeChunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contractRows.push(...(data ?? []));
  }

  const memberIds = [
    ...new Set(
      [
        ...rawLines.flatMap((line) => [
          line.recipientMemberId,
          line.effectiveOwnerMemberId,
        ]),
        ...contractRows.flatMap((row) => [
          row.settlement_sales_member_id ?? null,
          row.sales_member_id ?? null,
        ]),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ];
  const memberNameById = new Map<string, string>();
  for (const idChunk of chunks(memberIds, DB_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('organization_members')
      .select('id, name')
      .in('id', idChunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const member of data ?? []) {
      memberNameById.set(String(member.id), cleanMemberName(member.name));
    }
  }

  const contractMetaByCode = new Map<string, ReconciliationContractMeta>();
  for (const row of contractRows) {
    const ownerMemberId = String(
      row.settlement_sales_member_id ?? row.sales_member_id ?? '',
    ).trim() || null;
    const customerRelation = row.customers as { name?: string | null } | Array<{ name?: string | null }> | null;
    const customerName = Array.isArray(customerRelation)
      ? String(customerRelation[0]?.name ?? '')
      : String(customerRelation?.name ?? '');
    contractMetaByCode.set(String(row.contract_code), {
      contractCode: String(row.contract_code),
      contractId: String(row.id),
      customerName,
      productName: getContractDisplayProductName({
        product_type: row.product_type ?? null,
        item_name: row.item_name ?? null,
        source_snapshot_json: row.source_snapshot_json ?? null,
      }),
      ownerMemberId,
      ownerName: ownerMemberId ? (memberNameById.get(ownerMemberId) ?? '') : '',
    });
  }

  const systemLines: ReconciliationSystemLine[] = rawLines
    .filter((line) => line.contractCode && line.amount !== 0)
    .map((line) => ({
      contractCode: line.contractCode,
      contractId: line.contractId,
      recipientMemberId: line.recipientMemberId,
      recipientName: memberNameById.get(line.recipientMemberId) ?? line.recipientMemberId,
      effectiveOwnerName:
        line.effectiveOwnerNameHint ||
        (line.effectiveOwnerMemberId
          ? (memberNameById.get(line.effectiveOwnerMemberId) ?? '')
          : ''),
      amount: line.amount,
      payoutType: line.payoutType,
      unitCount: line.unitCount,
      organizationPath: line.organizationPath ?? null,
      upperRank: line.upperRank ?? null,
      lowerRank: line.lowerRank ?? null,
      upperUnitPrice: line.upperUnitPrice ?? null,
      lowerUnitPrice: line.lowerUnitPrice ?? null,
      rollupUnitPrice: line.rollupUnitPrice ?? null,
    }));

  const result = reconcileHeadquartersSettlements({
    excelRows,
    systemLines,
    contractMetaByCode,
  });

  for (const settlement of settlementsRes.data ?? []) {
    const detail = settlement.calculation_detail as SettlementCalculationDetail | null;
    if (!detail) continue;
    const hasRollupTotal = Number(settlement.rollup_commission ?? 0) !== 0;
    if (hasRollupTotal && !Array.isArray(detail.rollup_contract_items)) {
      warnings.push(
        `${cleanMemberName(detail.member_name)}: 이전 정산 데이터에 계약별 롤업 근거가 없어 롤업 계약 대사에서 제외됐습니다.`,
      );
    }
  }

  return NextResponse.json({
    success: true,
    yearMonth,
    files: files.map((file) => file.name),
    warnings,
    ...result,
  });
}
