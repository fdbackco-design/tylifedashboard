import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  parseHeadquartersSettlementFiles,
  parseSignedExcelAmount,
} from './reconciliation-excel';

async function workbookBuffer(
  sheetName: string,
  headers: string[],
  values: unknown[][],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getRow(6).values = headers;
  values.forEach((row, index) => {
    sheet.getRow(index + 7).values = row as ExcelJS.CellValue[];
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as unknown as ArrayLike<number>).buffer;
}

describe('본사 정산 엑셀 파서', () => {
  it('일반 정산서에서 순번 없이 계약코드와 signed VAT포함 금액을 읽는다', async () => {
    const buffer = await workbookBuffer(
      '08월분',
      ['순번', '고객명', '계약 코드', '상품명', '담당자', '수수료 (VAT포함)'],
      [
        ['', '고객1', 'TY001', '상품1', '담당1', '550,000'],
        ['', '고객2', 'TY002', '상품2', '담당2', -770_000],
      ],
    );
    const parsed = await parseHeadquartersSettlementFiles(
      [{ name: '일반.xlsx', buffer }],
      '2026-08',
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      contractCode: 'TY001',
      headquartersAmount: 550_000,
      sourceType: 'general',
    });
    expect(parsed.rows[1].headquartersAmount).toBe(-770_000);
  });

  it('케어플랜 당월 모집수당과 유지수당을 합산한다', async () => {
    const buffer = await workbookBuffer(
      '08월분',
      ['회원코드', '고객명', '상품명', '담당자', '당월모집수당', '당월유지수당'],
      [['TYCARE1', '고객1', 'TY케어플랜', '담당1', 18_182, 6_000]],
    );
    const parsed = await parseHeadquartersSettlementFiles(
      [{ name: '케어플랜.xlsx', buffer }],
      '2026-08',
    );
    expect(parsed.rows[0]).toMatchObject({
      contractCode: 'TYCARE1',
      headquartersAmount: 24_182,
      sourceType: 'care_plan',
    });
  });

  it('선택 월과 다른 시트는 읽지 않는다', async () => {
    const buffer = await workbookBuffer(
      '07월분',
      ['계약 코드', '수수료(VAT포함)'],
      [['TY001', 100]],
    );
    const parsed = await parseHeadquartersSettlementFiles(
      [{ name: '통합.xlsx', buffer }],
      '2026-08',
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.warnings[0]).toContain('08월 시트');
  });

  it('괄호 금액을 음수로 보존한다', () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('sheet');
    const cell = sheet.getCell('A1');
    cell.value = '(12,345원)';
    expect(parseSignedExcelAmount(cell)).toBe(-12_345);
  });
});
