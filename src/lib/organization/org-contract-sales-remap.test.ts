import { describe, expect, it } from 'vitest';
import { buildOrgContractSalesRemap, type OrgMemberForContractRemap } from './org-contract-sales-remap';

const customerMember: OrgMemberForContractRemap = {
  id: 'member-old',
  name: '이재천',
  rank: '영업사원',
  phone: '01087157433',
  external_id: 'cust:customer-old',
  source_customer_id: 'customer-old',
};
const customerBirthDateById = new Map([['customer-old', '1980-01-02']]);

describe('remapCustomerMemberId', () => {
  it('새 고객 ID라도 이름과 전화번호가 모두 같으면 기존 고객 노드로 연결한다', () => {
    const { remapCustomerMemberId } = buildOrgContractSalesRemap(
      [customerMember],
      customerBirthDateById,
    );

    expect(remapCustomerMemberId('customer-new', '이재천', '010-8715-7433', '1980-01-02')).toBe(
      'member-old',
    );
  });

  it('이름 또는 전화번호가 다르면 다른 고객 ID를 연결하지 않는다', () => {
    const { remapCustomerMemberId } = buildOrgContractSalesRemap(
      [customerMember],
      customerBirthDateById,
    );

    expect(remapCustomerMemberId('customer-new', '다른사람', '010-8715-7433', '1980-01-02')).toBe('');
    expect(remapCustomerMemberId('customer-new', '이재천', '010-0000-0000', '1980-01-02')).toBe('');
    expect(remapCustomerMemberId('customer-new', '이재천', '010-8715-7433', '1981-01-02')).toBe('');
  });

  it('같은 이름과 전화번호의 후보가 여러 명이면 자동 연결하지 않는다', () => {
    const duplicate = { ...customerMember, id: 'member-duplicate', source_customer_id: 'customer-other' };
    const birthDates = new Map(customerBirthDateById);
    birthDates.set('customer-other', '1980-01-02');
    const { remapCustomerMemberId } = buildOrgContractSalesRemap(
      [customerMember, duplicate],
      birthDates,
    );

    expect(remapCustomerMemberId('customer-new', '이재천', '010-8715-7433', '1980-01-02')).toBe('');
  });

  it('동명이인 고객 노드는 전화번호와 생년월일이 다르면 직원 노드와 병합하지 않는다', () => {
    const employee: OrgMemberForContractRemap = {
      id: 'leader-park',
      name: '박미선',
      rank: '리더',
      phone: '01057656850',
      external_id: 'cust:employee-customer',
      source_customer_id: 'employee-customer',
    };
    const customer: OrgMemberForContractRemap = {
      id: 'customer-park',
      name: '[고객] 박미선',
      rank: '영업사원',
      phone: '01071707562',
      external_id: 'customer:customer-customer',
      source_customer_id: 'customer-customer',
    };
    const births = new Map([
      ['employee-customer', '1986-04-13'],
      ['customer-customer', '1980-08-11'],
    ]);

    const ctx = buildOrgContractSalesRemap([employee, customer], births);

    expect(ctx.remapMemberId(customer.id)).toBe(customer.id);
    expect(ctx.membersFiltered.map((m) => m.id)).toEqual([employee.id, customer.id]);
  });

  it('이름·전화번호·생년월일이 모두 같은 customer 노드만 직원 노드로 병합한다', () => {
    const employee: OrgMemberForContractRemap = {
      id: 'employee',
      name: '홍길동',
      rank: '영업사원',
      phone: '01012345678',
      external_id: 'cust:employee-customer',
      source_customer_id: 'employee-customer',
    };
    const customer: OrgMemberForContractRemap = {
      id: 'customer',
      name: '[고객] 홍길동',
      rank: '영업사원',
      phone: '010-1234-5678',
      external_id: 'customer:duplicate-customer',
      source_customer_id: 'duplicate-customer',
    };
    const births = new Map([
      ['employee-customer', '1990-01-01'],
      ['duplicate-customer', '1990-01-01'],
    ]);

    const ctx = buildOrgContractSalesRemap([employee, customer], births);

    expect(ctx.remapMemberId(customer.id)).toBe(employee.id);
    expect(ctx.membersFiltered.map((m) => m.id)).toEqual([employee.id]);
  });
});
