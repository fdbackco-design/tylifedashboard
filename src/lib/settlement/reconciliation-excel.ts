import ExcelJS from 'exceljs';

export type HeadquartersSettlementSourceType = 'general' | 'care_plan';

export type HeadquartersSettlementExcelRow = {
  contractCode: string;
  customerName: string;
  productName: string;
  excelOwner: string;
  headquartersAmount: number;
  sourceType: HeadquartersSettlementSourceType;
  sourceFile: string;
  sheetName: string;
  rowNumber: number;
};

export type HeadquartersSettlementParseResult = {
  rows: HeadquartersSettlementExcelRow[];
  warnings: string[];
};

type UploadFile = {
  name: string;
  buffer: ArrayBuffer;
};

function normalizeHeader(value: string): string {
  return value
    .replace(/\r?\n/g, '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function cellScalar(cell: ExcelJS.Cell): unknown {
  if (cell.type === ExcelJS.ValueType.Formula) return cell.result;
  const value = cell.value;
  if (value && typeof value === 'object' && 'result' in value) {
    return (value as { result?: unknown }).result;
  }
  return value;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cellScalar(cell);
  if (value == null) return '';
  if (typeof value === 'object') {
    if ('text' in value) return String((value as { text?: unknown }).text ?? '').trim();
    if ('richText' in value) {
      return ((value as { richText?: Array<{ text?: string }> }).richText ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    }
  }
  return String(value).trim();
}

export function parseSignedExcelAmount(cell: ExcelJS.Cell): number | null {
  const value = cellScalar(cell);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') return null;
  const negativeByParentheses = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[,\s₩원()]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(negativeByParentheses ? -Math.abs(parsed) : parsed);
}

function findHeader(
  worksheet: ExcelJS.Worksheet,
): { rowNumber: number; byName: Map<string, number>; sourceType: HeadquartersSettlementSourceType } | null {
  const maxRows = Math.min(25, worksheet.rowCount);
  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const byName = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const normalized = normalizeHeader(cellText(cell));
      if (normalized) byName.set(normalized, columnNumber);
    });

    if (byName.has('회원코드') && byName.has('당월모집수당') && byName.has('당월유지수당')) {
      return { rowNumber, byName, sourceType: 'care_plan' };
    }
    if (byName.has('계약코드') && byName.has('수수료(vat포함)')) {
      return { rowNumber, byName, sourceType: 'general' };
    }
  }
  return null;
}

function firstColumn(byName: Map<string, number>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const found = byName.get(normalizeHeader(alias));
    if (found != null) return found;
  }
  return null;
}

function sheetMatchesYearMonth(sheetName: string, yearMonth: string): boolean {
  const month = Number(yearMonth.slice(5, 7));
  const match = sheetName.replace(/\s+/g, '').match(/(\d{1,2})월/);
  return match != null && Number(match[1]) === month;
}

export async function parseHeadquartersSettlementFiles(
  files: UploadFile[],
  yearMonth: string,
): Promise<HeadquartersSettlementParseResult> {
  const parsedRows: HeadquartersSettlementExcelRow[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const matchingSheets = workbook.worksheets.filter((sheet) =>
      sheetMatchesYearMonth(sheet.name, yearMonth),
    );
    if (matchingSheets.length === 0) {
      warnings.push(`${file.name}: ${yearMonth.slice(5, 7)}월 시트를 찾지 못했습니다.`);
      continue;
    }

    for (const worksheet of matchingSheets) {
      const header = findHeader(worksheet);
      if (!header) {
        warnings.push(`${file.name} / ${worksheet.name}: 지원하는 정산서 헤더를 찾지 못했습니다.`);
        continue;
      }

      const contractColumn = firstColumn(
        header.byName,
        header.sourceType === 'care_plan' ? ['회원코드'] : ['계약 코드'],
      );
      const customerColumn = firstColumn(header.byName, ['고객명']);
      const productColumn = firstColumn(header.byName, ['상품명']);
      const ownerColumn = firstColumn(header.byName, ['담당자']);
      const generalAmountColumn = firstColumn(header.byName, ['수수료(VAT포함)']);
      const recruitmentColumn = firstColumn(header.byName, ['당월모집수당']);
      const maintenanceColumn = firstColumn(header.byName, ['당월유지수당']);

      if (contractColumn == null) continue;
      for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const contractCode = cellText(row.getCell(contractColumn)).replace(/\s+/g, '').toUpperCase();
        if (!contractCode) continue;

        let headquartersAmount = 0;
        if (header.sourceType === 'general' && generalAmountColumn != null) {
          headquartersAmount = parseSignedExcelAmount(row.getCell(generalAmountColumn)) ?? 0;
        } else if (header.sourceType === 'care_plan') {
          headquartersAmount =
            (recruitmentColumn == null
              ? 0
              : (parseSignedExcelAmount(row.getCell(recruitmentColumn)) ?? 0)) +
            (maintenanceColumn == null
              ? 0
              : (parseSignedExcelAmount(row.getCell(maintenanceColumn)) ?? 0));
        }

        parsedRows.push({
          contractCode,
          customerName: customerColumn == null ? '' : cellText(row.getCell(customerColumn)),
          productName: productColumn == null ? '' : cellText(row.getCell(productColumn)),
          excelOwner: ownerColumn == null ? '' : cellText(row.getCell(ownerColumn)),
          headquartersAmount,
          sourceType: header.sourceType,
          sourceFile: file.name,
          sheetName: worksheet.name,
          rowNumber,
        });
      }
    }
  }

  const byContract = new Map<string, HeadquartersSettlementExcelRow>();
  for (const row of parsedRows) {
    const existing = byContract.get(row.contractCode);
    if (!existing) {
      byContract.set(row.contractCode, row);
      continue;
    }
    byContract.set(row.contractCode, {
      ...existing,
      customerName: existing.customerName || row.customerName,
      productName: existing.productName || row.productName,
      excelOwner: existing.excelOwner || row.excelOwner,
      headquartersAmount: existing.headquartersAmount + row.headquartersAmount,
    });
    warnings.push(
      `${row.contractCode}: 같은 정산월에 중복되어 본사 정산액을 합산했습니다. (${existing.sourceFile}, ${row.sourceFile})`,
    );
  }

  return { rows: [...byContract.values()], warnings };
}
