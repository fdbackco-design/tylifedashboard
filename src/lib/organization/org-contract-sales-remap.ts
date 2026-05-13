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
  remapCustomerMemberId: (customerId: string) => string;
  hqIds: Set<string>;
  membersFiltered: OrgMemberForContractRemap[];
} {
  const toPhoneDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');
  const normName = (v: string | null | undefined) => (v ?? '').replace(/^\[고객\]\s*/, '').trim();

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
    const digits = toPhoneDigits(m.phone);
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
    if (customerMemberId) return remapMemberId(customerMemberId);

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

  const remapCustomerMemberId = (customerId: string) =>
    remapMemberId(customerMemberIdByCustomerId.get(customerId) ?? '');

  return {
    remapMemberId,
    resolveContractSalesMemberId,
    remapCustomerMemberId,
    hqIds,
    membersFiltered,
  };
}
