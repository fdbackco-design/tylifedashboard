import { describe, expect, it } from 'vitest';
import type { HeadquartersSettlementExcelRow } from './reconciliation-excel';
import {
  reconcileHeadquartersSettlements,
  type ReconciliationContractMeta,
  type ReconciliationSystemLine,
} from './reconciliation';

function excel(
  contractCode: string,
  headquartersAmount: number,
  excelOwner = '담당자1',
): HeadquartersSettlementExcelRow {
  return {
    contractCode,
    customerName: '고객',
    productName: '상품',
    excelOwner,
    headquartersAmount,
    sourceType: 'general',
    sourceFile: '본사.xlsx',
    sheetName: '08월분',
    rowNumber: 7,
  };
}

function system(
  contractCode: string,
  amount: number,
  payoutType: ReconciliationSystemLine['payoutType'] = '개인수당',
): ReconciliationSystemLine {
  return {
    contractCode,
    contractId: contractCode,
    recipientMemberId: 'member-1',
    recipientName: '담당자1',
    effectiveOwnerName: '담당자1',
    amount,
    payoutType,
    unitCount: 1,
  };
}

function meta(contractCode: string): ReconciliationContractMeta {
  return {
    contractCode,
    contractId: contractCode,
    customerName: '고객',
    productName: '상품',
    ownerMemberId: 'member-1',
    ownerName: '담당자1',
  };
}

describe('본사 계약 목록 대사', () => {
  it('본사와 시스템에 모두 있는 계약은 기존 시스템 수당을 예상액으로 사용한다', () => {
    const result = reconcileHeadquartersSettlements({
      excelRows: [excel('TY001', 550_000)],
      systemLines: [system('TY001', 370_000)],
      contractMetaByCode: new Map([['TY001', meta('TY001')]]),
    });
    expect(result.members[0]).toMatchObject({
      currentAmount: 370_000,
      expectedAmount: 370_000,
      difference: 0,
    });
    expect(result.members[0].detailRows[0].reason).toBe('정상');
  });

  it('본사에만 있는 계약은 임의 계산하지 않고 미산출로 둔다', () => {
    const result = reconcileHeadquartersSettlements({
      excelRows: [excel('TY002', 550_000)],
      systemLines: [],
      contractMetaByCode: new Map([['TY002', meta('TY002')]]),
    });
    expect(result.members[0].unresolvedCount).toBe(1);
    expect(result.members[0].detailRows[0]).toMatchObject({
      expectedAmount: null,
      payoutType: '미산출',
      reason: '본사 정산됨 / 시스템 정산 누락',
    });
  });

  it('시스템에만 있는 계약은 본사 미정산으로 분류한다', () => {
    const result = reconcileHeadquartersSettlements({
      excelRows: [],
      systemLines: [system('TY003', 370_000)],
      contractMetaByCode: new Map([['TY003', meta('TY003')]]),
    });
    expect(result.members[0]).toMatchObject({
      currentAmount: 370_000,
      expectedAmount: 0,
      difference: -370_000,
    });
    expect(result.members[0].detailRows[0].reason).toBe('시스템 정산됨 / 본사 미정산');
  });

  it('본사 0원이고 시스템에도 없는 계약은 정상 미정산으로 본다', () => {
    const result = reconcileHeadquartersSettlements({
      excelRows: [excel('TY003-ZERO', 0)],
      systemLines: [],
      contractMetaByCode: new Map([['TY003-ZERO', meta('TY003-ZERO')]]),
    });
    expect(result.members[0]).toMatchObject({
      currentAmount: 0,
      expectedAmount: 0,
      difference: 0,
      unresolvedCount: 0,
    });
    expect(result.members[0].detailRows[0]).toMatchObject({
      payoutType: '미정산',
      reason: '정상',
    });
  });

  it('본사 음수 금액과 기존 환수 라인을 환수 계약으로 표시한다', () => {
    const result = reconcileHeadquartersSettlements({
      excelRows: [excel('TY004', -770_000)],
      systemLines: [system('TY004', -370_000, '환수금')],
      contractMetaByCode: new Map([['TY004', meta('TY004')]]),
    });
    expect(result.members[0].detailRows[0]).toMatchObject({
      headquartersAmount: -770_000,
      systemAmount: -370_000,
      expectedAmount: -370_000,
      reason: '본사 환수 계약',
    });
  });

  it('엑셀 담당자와 계약 담당자가 다르면 담당자 매칭 차이로 표시한다', () => {
    const result = reconcileHeadquartersSettlements({
      excelRows: [excel('TY005', 550_000, '다른담당자')],
      systemLines: [system('TY005', 370_000)],
      contractMetaByCode: new Map([['TY005', meta('TY005')]]),
    });
    expect(result.members[0].detailRows[0].reason).toBe('담당자 매칭 차이');
  });
});
