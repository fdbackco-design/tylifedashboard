import { describe, expect, it } from 'vitest';
import {
  buildCarePlanAutomaticLine,
  carePlanRecruitmentYearMonth,
  monthsBetween,
} from './care-plan-commission';

const contract = {
  id: 'contract-1',
  contract_code: 'TY-CARE-1',
  unit_count: 2,
  status: '가입',
  is_cancelled: false,
  happy_call_at: '2026-08-20T00:00:00+09:00',
  happycall_result: '성공',
  product_type: 'TY케어플랜',
  item_name: '',
  source_snapshot_json: { 상품명: 'TY케어플랜150' },
  sales_member_id: 'member-1',
  settlement_sales_member_id: null,
  updated_at: '2026-08-20T00:00:00+09:00',
};

describe('케어플랜 모집·유지수당', () => {
  it('해피콜 정산월에 구좌당 18,182원 모집수당을 1회 계산한다', () => {
    const line = buildCarePlanAutomaticLine({ contract, yearMonth: '2026-08' });
    expect(line).toMatchObject({
      commission_type: 'recruitment',
      installment_no: 0,
      unit_count: 2,
      unit_amount_won: 18_182,
      amount_won: 36_364,
      recipient_member_id: 'member-1',
    });
  });

  it('다음 달부터 구좌당 6,000원 유지수당을 최대 24회 계산한다', () => {
    const first = buildCarePlanAutomaticLine({ contract, yearMonth: '2026-09' });
    expect(first).toMatchObject({
      commission_type: 'maintenance',
      installment_no: 1,
      amount_won: 12_000,
    });
    expect(buildCarePlanAutomaticLine({ contract, yearMonth: '2028-08' })).toMatchObject({
      installment_no: 24,
    });
    expect(buildCarePlanAutomaticLine({ contract, yearMonth: '2028-09' })).toBeNull();
  });

  it('해당 정산월 마감일까지 해약한 계약은 그 달 수당을 지급하지 않는다', () => {
    expect(
      buildCarePlanAutomaticLine({
        contract,
        yearMonth: '2026-09',
        cancellationYmd: '2026-09-10',
      }),
    ).toBeNull();
  });

  it('직급과 무관하고 settlement 담당자 override를 우선한다', () => {
    const line = buildCarePlanAutomaticLine({
      contract: { ...contract, settlement_sales_member_id: 'member-override' },
      yearMonth: '2026-08',
    });
    expect(line?.recipient_member_id).toBe('member-override');
  });

  it('정산월과 월차를 안정적으로 계산한다', () => {
    expect(carePlanRecruitmentYearMonth('2026-08-25')).toBe('2026-08');
    expect(carePlanRecruitmentYearMonth('2026-08-26')).toBe('2026-09');
    expect(monthsBetween('2026-08', '2028-08')).toBe(24);
  });
});
