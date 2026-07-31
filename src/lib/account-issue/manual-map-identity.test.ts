import { describe, expect, it } from 'vitest';
import { validateManualCustomerMapIdentity } from './manual-map-identity';

const base = {
  profileName: '김혜현',
  profilePhone: '010-5958-4998',
  issuedBirthDate: '1975-03-28',
  customerName: '[고객] 김혜현',
  customerPhone: '01059584998',
  customerBirthDate: '19750328',
};

describe('validateManualCustomerMapIdentity', () => {
  it('이름·전화번호·생년월일이 모두 같을 때만 허용한다', () => {
    expect(validateManualCustomerMapIdentity(base)).toEqual({ ok: true });
  });

  it('동명이인이지만 전화번호가 다르면 거부한다', () => {
    expect(
      validateManualCustomerMapIdentity({
        ...base,
        customerPhone: '01092337897',
      }),
    ).toEqual({ ok: false, reason: 'PHONE_MISMATCH' });
  });

  it('이름과 전화번호가 같아도 생년월일이 다르면 거부한다', () => {
    expect(
      validateManualCustomerMapIdentity({
        ...base,
        customerBirthDate: '1974-05-03',
      }),
    ).toEqual({ ok: false, reason: 'BIRTH_DATE_MISMATCH' });
  });

  it('생년월일을 확인할 수 없으면 자동 병합하지 않는다', () => {
    expect(
      validateManualCustomerMapIdentity({
        ...base,
        issuedBirthDate: null,
      }),
    ).toEqual({ ok: false, reason: 'BIRTH_DATE_MISSING' });
  });
});
