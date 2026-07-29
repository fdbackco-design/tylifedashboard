import { describe, expect, it } from 'vitest';
import {
  buildSalesCodeIssuanceValues,
  createEmployeeId,
  createResidentNumber,
  formatIssuancePhone,
} from './issuance';

describe('sales-code issuance values', () => {
  it('fed 접두사와 휴대폰 뒤 8자리로 사원ID를 만든다', () => {
    expect(createEmployeeId('010-1234-5678')).toBe('fed12345678');
  });

  it('1999년까지 주민번호 구분 숫자 1/2를 사용한다', () => {
    expect(createResidentNumber('1999-12-31', '남')).toBe('991231-1000000');
    expect(createResidentNumber('1999-12-31', '여')).toBe('991231-2000000');
  });

  it('2000년부터 주민번호 구분 숫자 3/4를 사용한다', () => {
    expect(createResidentNumber('2000-01-01', '남')).toBe('000101-3000000');
    expect(createResidentNumber('2002-05-06', '여')).toBe('020506-4000000');
  });

  it('초기 비밀번호는 휴대폰 전체 숫자를 사용한다', () => {
    expect(
      buildSalesCodeIssuanceValues({
        birthDate: '19931221',
        gender: '남',
        phone: '010-2024-9656',
      }),
    ).toEqual({
      employeeId: 'fed20249656',
      residentNumber: '931221-1000000',
      phoneDigits: '01020249656',
      formattedPhone: '010-2024-9656',
      initialPassword: '01020249656',
    });
  });

  it('잘못된 개인정보는 생성하지 않는다', () => {
    expect(() => createEmployeeId('1234')).toThrow('휴대폰번호');
    expect(() => createResidentNumber('20000230', '남')).toThrow('생년월일');
    expect(() => createResidentNumber('20000101', '')).toThrow('성별');
  });

  it('10자리 전화번호도 표시 형식을 적용한다', () => {
    expect(formatIssuancePhone('0101234567')).toBe('010-123-4567');
  });
});
