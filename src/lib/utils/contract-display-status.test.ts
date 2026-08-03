import { describe, expect, it } from 'vitest';
import { getContractDisplayStatus } from './contract-display-status';

describe('getContractDisplayStatus', () => {
  it.each([
    ['취소', '취소'],
    ['청약 철회', '청약철회'],
    ['청약철회', '청약철회'],
    ['해약', '해약'],
  ])('송장번호가 있어도 종료 상태 %s를 유지한다', (status, expected) => {
    expect(
      getContractDisplayStatus({
        status,
        invoice_no: '44669296044 [-]',
      }),
    ).toBe(expected);
  });

  it('종료 상태가 아니고 송장번호가 있으면 가입으로 표시한다', () => {
    expect(
      getContractDisplayStatus({
        status: '준비',
        invoice_no: '44669296044 [-]',
      }),
    ).toBe('가입');
  });

  it('TY케어플랜은 송장 없이 해피콜 성공이면 가입으로 표시한다', () => {
    expect(
      getContractDisplayStatus({
        status: '준비',
        invoice_no: null,
        product_type: 'TY케어플랜',
        item_name: 'TY케어플랜',
        happy_call_at: '2026-07-20',
        happycall_result: '성공',
      }),
    ).toBe('가입');
  });
});
