import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';

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
};

/**
 * /admin/organization 과 동일: customer 노드 병합 + 본사(HQ) 직계약 중 가입 인정 계약을
 * 고객(조직원) 노드로 귀속해 산하 계약처럼 집계한다.
 */
export function buildOrgContractSalesRemap(
  membersRaw: OrgMemberForContractRemap[],
): {
  remapMemberId: (id: string) => string;
  resolveContractSalesMemberId: (c: ContractSalesRemapInput) => string;
  /** 내 조직도 등: 귀속 id가 서브트리 밖(HQ)이면 가입 인정+고객 매핑으로 서브트리 내 id를 한 번 더 시도 */
  resolveContractOriginForSubtree: (c: ContractSalesRemapInput, subtreeMemberIds: Set<string>) => string;
  remapCustomerMemberId: (
    customerId: string,
    expectedName?: string | null,
    customerPhone?: string | null,
  ) => string;
  hqIds: Set<string>;
  membersFiltered: OrgMemberForContractRemap[];
} {
  const toPhoneDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
  const normName = (v: string | null | undefined) => (v ?? '').replace(/^\[고객\]\s*/, '').trim();

  // 노드 id → 정규화 이름 (자기구매 귀속 시 고객명/노드명 일치 검증용)
  const normNameById = new Map<string, string>();
  for (const m of membersRaw) normNameById.set(m.id, normName(m.name));

  // customer_id 가 서로 다른 사람에게 공유될 수 있으므로(예: 주민번호 마스킹=생년월일 충돌),
  // "고객 노드 자기구매 귀속"은 계약 고객명이 대상 노드명과 일치할 때만 적용한다.
  const customerNameMatches = (memberId: string, expectedName: string | null | undefined): boolean => {
    const expected = normName(expectedName);
    if (!expected) return true; // 고객명이 없으면(구버전 호출) 기존 동작 유지
    const actual = normNameById.get(memberId) ?? '';
    if (!actual) return true;
    return expected === actual;
  };

  const employeesByKey = new Map<string, string>();
  const customerMergeTo = new Map<string, string>();

  for (const m of membersRaw) {
    const ext = m.external_id ?? null;
    const nName = normName(m.name);
    const digits = toPhoneDigits(m.phone);
    const key = `${nName}|${digits}`;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode && toPhoneDigits(m.phone)) {
      if (!employeesByKey.has(key)) employeesByKey.set(key, m.id);
    }
  }

  for (const m of membersRaw) {
    const ext = m.external_id ?? null;
    const isCustomerNode = ext?.startsWith('customer:') ?? false;
    if (!isCustomerNode) continue;
    const digits = toPhoneDigits(m.phone);
    const nName = normName(m.name);
    if (digits) {
      const key = `${nName}|${digits}`;
      const employeeId = employeesByKey.get(key);
      if (employeeId) {
        customerMergeTo.set(m.id, employeeId);
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
  const nodeIdByPhoneDigits = new Map<string, string>();

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
    const digits = toPhoneDigits(m.phone);
    const namePhoneKey = `${normName(m.name)}|${digits}`;
    if (isCustomerIdentity && m.rank !== '본사' && normName(m.name) && digits) {
      const ids = customerMemberIdsByNamePhone.get(namePhoneKey) ?? new Set<string>();
      ids.add(m.id);
      customerMemberIdsByNamePhone.set(namePhoneKey, ids);
    }
    if (digits) nodeIdByPhoneDigits.set(digits, m.id);
  }

  const hqIds = new Set(
    membersFiltered.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id),
  );

  const findCustomerNodeId = (c: { customer_id: string; customer_phone: string | null }): string | null => {
    const byExt =
      customerIdToEffectiveMemberId.get(c.customer_id) ?? customerNodeByCustomerId.get(c.customer_id);
    if (byExt) return byExt;
    const digits = toPhoneDigits(c.customer_phone);
    if (digits) {
      const byPhone = nodeIdByPhoneDigits.get(digits);
      if (byPhone) return byPhone;
    }
    return null;
  };

  const resolveContractSalesMemberId = (c: ContractSalesRemapInput): string => {
    const customerMemberId = customerMemberIdByCustomerId.get(c.customer_id) ?? null;
    if (customerMemberId) {
      const merged = remapMemberId(customerMemberId);
      // 공유 customer_id 방어: 고객명이 대상 노드명과 일치할 때만 자기구매 귀속.
      if (customerNameMatches(merged, c.customer_name)) return merged;
      // 불일치면 아래 일반 담당자 귀속 로직으로 진행(예: 김미옥 계약 → 담당자 한진호).
    }

    const joinEligible = isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });

    if (hqIds.size > 0 && hqIds.has(c.sales_member_id) && joinEligible) {
      const customerNodeId = findCustomerNodeId({
        customer_id: c.customer_id,
        customer_phone: c.customer_phone ?? null,
      });
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
    const customerNodeId = findCustomerNodeId({
      customer_id: c.customer_id,
      customer_phone: c.customer_phone ?? null,
    });
    if (!customerNodeId) return primary;
    const merged = remapMemberId(customerNodeId);
    return subtreeMemberIds.has(merged) ? merged : primary;
  };

  const remapCustomerMemberId = (
    customerId: string,
    expectedName?: string | null,
    customerPhone?: string | null,
  ): string => {
    const merged = remapMemberId(customerMemberIdByCustomerId.get(customerId) ?? '');
    // 공유 customer_id 방어: 고객명이 지정되면 노드명과 일치할 때만 매핑을 인정.
    if (merged && (expectedName === undefined || customerNameMatches(merged, expectedName))) {
      return merged;
    }

    // TY Life에서 같은 사람이 새 customers 행으로 재생성될 수 있다. 이 경우 고객 ID는 달라도
    // 이름과 전화번호가 모두 같고 후보가 하나뿐일 때 기존 조직 노드로 안전하게 연결한다.
    const expected = normName(expectedName);
    const digits = toPhoneDigits(customerPhone);
    if (!expected || !digits) return '';
    const candidates = customerMemberIdsByNamePhone.get(`${expected}|${digits}`);
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
