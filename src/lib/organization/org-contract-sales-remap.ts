import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import {
  buildCustomerIdentityKey,
  normalizeCustomerIdentityBirthDate,
  normalizeCustomerIdentityName,
} from '@/lib/organization/customer-identity';

/** 조직도 계약 담당자 치환용 최소 멤버 필드 */
export type OrgMemberForContractRemap = {
  id: string;
  name: string;
  rank: string;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
};

export type ContractSalesRemapInput = {
  sales_member_id: string;
  customer_id: string;
  status: string;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
  customer_phone?: string | null;
  contract_code?: string | null;
  customer_name?: string | null;
  customer_birth_date?: string | null;
};

/**
 * /admin/organization 과 동일: customer 노드 병합 + 본사(HQ) 직계약 중 가입 인정 계약을
 * 고객(조직원) 노드로 귀속해 산하 계약처럼 집계한다.
 */
export function buildOrgContractSalesRemap(
  membersRaw: OrgMemberForContractRemap[],
  customerBirthDateById: ReadonlyMap<string, string | null> = new Map(),
): {
  remapMemberId: (id: string) => string;
  resolveContractSalesMemberId: (c: ContractSalesRemapInput) => string;
  /** 내 조직도 등: 귀속 id가 서브트리 밖(HQ)이면 가입 인정+고객 매핑으로 서브트리 내 id를 한 번 더 시도 */
  resolveContractOriginForSubtree: (c: ContractSalesRemapInput, subtreeMemberIds: Set<string>) => string;
  remapCustomerMemberId: (
    customerId: string,
    expectedName?: string | null,
    customerPhone?: string | null,
    customerBirthDate?: string | null,
  ) => string;
  hqIds: Set<string>;
  membersFiltered: OrgMemberForContractRemap[];
} {
  const normName = normalizeCustomerIdentityName;
  const customerIdForMember = (m: OrgMemberForContractRemap): string | null => {
    if (m.source_customer_id) return m.source_customer_id;
    const ext = m.external_id ?? '';
    if (ext.startsWith('customer:')) return ext.slice('customer:'.length);
    if (ext.startsWith('cust:')) return ext.slice('cust:'.length);
    return null;
  };
  const birthDateForMember = (m: OrgMemberForContractRemap): string => {
    const customerId = customerIdForMember(m);
    return customerId
      ? normalizeCustomerIdentityBirthDate(customerBirthDateById.get(customerId))
      : '';
  };
  const identityKey = (
    name: string | null | undefined,
    phone: string | null | undefined,
    birthDate: string | null | undefined,
  ): string | null => buildCustomerIdentityKey({ name, phone, birthDate });

  const memberById = new Map(membersRaw.map((m) => [m.id, m]));

  // 이름만 같거나 식별값 일부가 누락된 경우에는 다른 사람일 수 있으므로 자동 귀속하지 않는다.
  const customerIdentityMatches = (
    memberId: string,
    expectedName: string | null | undefined,
    expectedPhone: string | null | undefined,
    expectedBirthDate: string | null | undefined,
  ): boolean => {
    const member = memberById.get(memberId);
    if (!member) return false;
    const expectedKey = identityKey(expectedName, expectedPhone, expectedBirthDate);
    const actualKey = identityKey(member.name, member.phone, birthDateForMember(member));
    return expectedKey != null && actualKey != null && expectedKey === actualKey;
  };

  const employeesByKey = new Map<string, Set<string>>();
  const customerMergeTo = new Map<string, string>();

  for (const m of membersRaw) {
    const ext = m.external_id ?? null;
    const nName = normName(m.name);
    const key = identityKey(nName, m.phone, birthDateForMember(m));
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode && key) {
      const employeeIds = employeesByKey.get(key) ?? new Set<string>();
      employeeIds.add(m.id);
      employeesByKey.set(key, employeeIds);
    }
  }

  for (const m of membersRaw) {
    const ext = m.external_id ?? null;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode) continue;
    const key = identityKey(m.name, m.phone, birthDateForMember(m));
    if (key) {
      const employeeIds = employeesByKey.get(key);
      if (employeeIds?.size === 1) {
        const employeeId = employeeIds.values().next().value;
        if (employeeId) customerMergeTo.set(m.id, employeeId);
      }
    }
  }

  const remapMemberId = (id: string) => customerMergeTo.get(id) ?? id;

  const customerIdToEffectiveMemberId = new Map<string, string>();
  for (const m of membersRaw) {
    const ext = m.external_id ?? null;
    const sourceCustomerId = m.source_customer_id ?? null;
    if (sourceCustomerId) {
      customerIdToEffectiveMemberId.set(sourceCustomerId, remapMemberId(m.id));
      continue;
    }
    if (ext && ext.startsWith('customer:')) {
      const customerId = ext.slice('customer:'.length);
      customerIdToEffectiveMemberId.set(customerId, remapMemberId(m.id));
    }
  }

  const membersFiltered = membersRaw.filter((m) => !customerMergeTo.has(m.id));

  const customerNodeByCustomerId = new Map<string, string>();
  const customerMemberIdByCustomerId = new Map<string, string>();
  const customerMemberIdsByNamePhone = new Map<string, Set<string>>();
  const nodeIdsByIdentity = new Map<string, Set<string>>();

  for (const m of membersFiltered) {
    const ext = m.external_id ?? null;
    if (ext && ext.startsWith('customer:')) {
      const customerId = ext.slice('customer:'.length);
      customerNodeByCustomerId.set(customerId, m.id);
    }
    const sid = m.source_customer_id ?? null;
    if (sid && m.rank !== '본사') {
      customerMemberIdByCustomerId.set(sid, m.id);
    } else if (ext && ext.startsWith('customer:') && m.rank !== '본사') {
      const customerId = ext.slice('customer:'.length);
      if (!customerMemberIdByCustomerId.has(customerId)) {
        customerMemberIdByCustomerId.set(customerId, m.id);
      }
    }
    const isCustomerIdentity =
      Boolean(sid) || Boolean(ext?.startsWith('customer:')) || Boolean(ext?.startsWith('cust:'));
    const customerIdentityKey = identityKey(m.name, m.phone, birthDateForMember(m));
    if (isCustomerIdentity && m.rank !== '본사' && customerIdentityKey) {
      const ids = customerMemberIdsByNamePhone.get(customerIdentityKey) ?? new Set<string>();
      ids.add(m.id);
      customerMemberIdsByNamePhone.set(customerIdentityKey, ids);
      const allIds = nodeIdsByIdentity.get(customerIdentityKey) ?? new Set<string>();
      allIds.add(m.id);
      nodeIdsByIdentity.set(customerIdentityKey, allIds);
    }
  }

  const hqIds = new Set(
    membersFiltered.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id),
  );

  const findCustomerNodeId = (c: ContractSalesRemapInput): string | null => {
    const byExt =
      customerIdToEffectiveMemberId.get(c.customer_id) ?? customerNodeByCustomerId.get(c.customer_id);
    if (
      byExt &&
      customerIdentityMatches(byExt, c.customer_name, c.customer_phone, c.customer_birth_date)
    ) {
      return byExt;
    }
    const key = identityKey(c.customer_name, c.customer_phone, c.customer_birth_date);
    if (!key) return null;
    const candidates = nodeIdsByIdentity.get(key);
    if (candidates?.size === 1) return candidates.values().next().value ?? null;
    return null;
  };

  const resolveContractSalesMemberId = (c: ContractSalesRemapInput): string => {
    const customerMemberId = customerMemberIdByCustomerId.get(c.customer_id) ?? null;
    if (customerMemberId) {
      const merged = remapMemberId(customerMemberId);
      // 공유 customer_id 방어: 고객명이 대상 노드명과 일치할 때만 자기구매 귀속.
      if (
        customerIdentityMatches(
          merged,
          c.customer_name,
          c.customer_phone,
          c.customer_birth_date,
        )
      ) {
        return merged;
      }
      // 불일치면 아래 일반 담당자 귀속 로직으로 진행(예: 김미옥 계약 → 담당자 한진호).
    }

    const joinEligible = isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });

    if (hqIds.size > 0 && hqIds.has(c.sales_member_id) && joinEligible) {
      const customerNodeId = findCustomerNodeId(c);
      if (customerNodeId) return remapMemberId(customerNodeId);
    }
    return remapMemberId(c.sales_member_id);
  };

  const resolveContractOriginForSubtree = (
    c: ContractSalesRemapInput,
    subtreeMemberIds: Set<string>,
  ): string => {
    const primary = resolveContractSalesMemberId(c);
    if (subtreeMemberIds.has(primary)) return primary;
    if (hqIds.size === 0 || !hqIds.has(c.sales_member_id)) return primary;
    const joinEligible = isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });
    if (!joinEligible) return primary;
    const customerNodeId = findCustomerNodeId(c);
    if (!customerNodeId) return primary;
    const merged = remapMemberId(customerNodeId);
    return subtreeMemberIds.has(merged) ? merged : primary;
  };

  const remapCustomerMemberId = (
    customerId: string,
    expectedName?: string | null,
    customerPhone?: string | null,
    customerBirthDate?: string | null,
  ): string => {
    const merged = remapMemberId(customerMemberIdByCustomerId.get(customerId) ?? '');
    if (
      merged &&
      customerIdentityMatches(merged, expectedName, customerPhone, customerBirthDate)
    ) {
      return merged;
    }

    // TY Life에서 같은 사람이 새 customers 행으로 재생성될 수 있다. 이 경우 고객 ID는 달라도
    // 이름·전화번호·생년월일이 모두 같고 후보가 하나뿐일 때만 기존 조직 노드로 연결한다.
    const key = identityKey(expectedName, customerPhone, customerBirthDate);
    if (!key) return '';
    const candidates = customerMemberIdsByNamePhone.get(key);
    if (!candidates || candidates.size !== 1) return '';
    return remapMemberId(candidates.values().next().value ?? '');
  };

  return {
    remapMemberId,
    resolveContractSalesMemberId,
    resolveContractOriginForSubtree,
    remapCustomerMemberId,
    hqIds,
    membersFiltered,
  };
}
