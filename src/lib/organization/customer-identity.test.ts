import { describe, expect, it } from 'vitest';
import { buildCustomerIdentityKey } from './customer-identity';

describe('buildCustomerIdentityKey', () => {
  it('이름·정규화 전화번호·생년월일이 모두 같을 때 같은 identity를 만든다', () => {
    expect(
      buildCustomerIdentityKey({
        name: '[고객] 박미선',
        phone: '010-7170-7562',
        birthDate: '1980-08-11',
      }),
    ).toBe(
      buildCustomerIdentityKey({
        name: '박미선',
        phone: '01071707562',
        birthDate: '1980-08-11T00:00:00.000Z',
      }),
    );
  });

  it('동명이인이어도 전화번호 또는 생년월일이 다르면 다른 identity로 판단한다', () => {
    const customer = buildCustomerIdentityKey({
      name: '박미선',
      phone: '01071707562',
      birthDate: '1980-08-11',
    });
    const leader = buildCustomerIdentityKey({
      name: '박미선',
      phone: '01057656850',
      birthDate: '1986-04-13',
    });

    expect(customer).not.toBe(leader);
  });

  it('식별값이 하나라도 없으면 이름만으로 자동 병합하지 않는다', () => {
    expect(buildCustomerIdentityKey({ name: '박미선', phone: null, birthDate: '1980-08-11' })).toBeNull();
    expect(buildCustomerIdentityKey({ name: '박미선', phone: '01071707562', birthDate: null })).toBeNull();
    expect(buildCustomerIdentityKey({ name: '', phone: '01071707562', birthDate: '1980-08-11' })).toBeNull();
  });
});
