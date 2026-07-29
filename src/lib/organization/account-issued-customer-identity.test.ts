import { describe, expect, it } from 'vitest';
import { resolveAccountIssuedMemberForCustomer } from './account-issued-customer-identity';

const customer = {
  name: '박미선',
  phone: '010-7170-7562',
  birthDate: '1980-08-11',
};

describe('resolveAccountIssuedMemberForCustomer', () => {
  it('발급 신청서와 계정이 연결된 이름-only 담당자 노드를 동일 고객으로 찾는다', () => {
    expect(
      resolveAccountIssuedMemberForCustomer({
        customer,
        requests: [
          {
            employee_id: 'fed71707562',
            name: '박미선',
            phone_digits: '01071707562',
            birth_date: '19800811',
          },
        ],
        profiles: [{ member_id: 'sales-member', login_code: 'FED71707562' }],
        members: [{ id: 'sales-member', name: '박미선', rank: '영업사원' }],
      }),
    ).toBe('sales-member');
  });

  it('이름이 같아도 전화번호나 생년월일이 다르면 연결하지 않는다', () => {
    expect(
      resolveAccountIssuedMemberForCustomer({
        customer,
        requests: [
          {
            employee_id: 'fed57656850',
            name: '박미선',
            phone_digits: '01057656850',
            birth_date: '19860413',
          },
        ],
        profiles: [{ member_id: 'leader-park', login_code: 'fed57656850' }],
        members: [{ id: 'leader-park', name: '박미선', rank: '리더' }],
      }),
    ).toBeNull();
  });

  it('이전 8자리 로그인 계정도 신청서 전화번호로 연결한다', () => {
    expect(
      resolveAccountIssuedMemberForCustomer({
        customer,
        requests: [
          {
            employee_id: null,
            name: '박미선',
            phone_digits: '01071707562',
            birth_date: '19800811',
          },
        ],
        profiles: [{ member_id: 'legacy-sales-member', login_code: '71707562' }],
        members: [{ id: 'legacy-sales-member', name: '박미선', rank: '영업사원' }],
      }),
    ).toBe('legacy-sales-member');
  });

  it('정확히 일치하는 계정 연결 멤버가 여러 명이면 자동 병합하지 않는다', () => {
    const request = {
      employee_id: 'fed71707562',
      name: '박미선',
      phone_digits: '01071707562',
      birth_date: '19800811',
    };

    expect(
      resolveAccountIssuedMemberForCustomer({
        customer,
        requests: [request],
        profiles: [
          { member_id: 'member-a', login_code: 'fed71707562' },
          { member_id: 'member-b', login_code: 'fed71707562' },
        ],
        members: [
          { id: 'member-a', name: '박미선', rank: '영업사원' },
          { id: 'member-b', name: '박미선', rank: '영업사원' },
        ],
      }),
    ).toBeNull();
  });
});
