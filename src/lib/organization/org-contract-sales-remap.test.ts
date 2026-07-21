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

describe('remapCustomerMemberId', () => {
  it('새 고객 ID라도 이름과 전화번호가 모두 같으면 기존 고객 노드로 연결한다', () => {
    const { remapCustomerMemberId } = buildOrgContractSalesRemap([customerMember]);

    expect(remapCustomerMemberId('customer-new', '이재천', '010-8715-7433')).toBe('member-old');
  });

  it('이름 또는 전화번호가 다르면 다른 고객 ID를 연결하지 않는다', () => {
    const { remapCustomerMemberId } = buildOrgContractSalesRemap([customerMember]);

    expect(remapCustomerMemberId('customer-new', '다른사람', '010-8715-7433')).toBe('');
    expect(remapCustomerMemberId('customer-new', '이재천', '010-0000-0000')).toBe('');
  });

  it('같은 이름과 전화번호의 후보가 여러 명이면 자동 연결하지 않는다', () => {
    const duplicate = { ...customerMember, id: 'member-duplicate', source_customer_id: 'customer-other' };
    const { remapCustomerMemberId } = buildOrgContractSalesRemap([customerMember, duplicate]);

    expect(remapCustomerMemberId('customer-new', '이재천', '010-8715-7433')).toBe('');
  });
});
