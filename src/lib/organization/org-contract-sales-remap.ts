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

/** `?debug=1` 등에서 귀속 실패 원인을 적을 때 사용 */
export type ContractOriginExplain = {
  sales_member_id: string;
  customer_id: string;
  /** customer_member_id 직매핑으로 나온 1차 귀속 (있을 때만) */
  via_customer_member_id: string | null;
  primary_resolved_id: string;
  primary_in_subtree: boolean;
  sales_is_hq: boolean;
  join_display_completed: boolean;
  customer_org_node_id: string | null;
  merged_customer_member_id: string | null;
  merged_in_subtree: boolean;
  final_origin_id: string;
  final_in_subtree: boolean;
  reason: string;
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
  explainContractOriginForSubtree: (
    c: ContractSalesRemapInput,
    subtreeMemberIds: Set<string>,
  ) => ContractOriginExplain;
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

  const explainContractOriginForSubtree = (
    c: ContractSalesRemapInput,
    subtreeMemberIds: Set<string>,
  ): ContractOriginExplain => {
    const viaCustomerMemberId = customerMemberIdByCustomerId.get(c.customer_id) ?? null;
    const primary = resolveContractSalesMemberId(c);
    const primaryInSubtree = subtreeMemberIds.has(primary);
    const salesIsHq = hqIds.has(c.sales_member_id);
    const joinDisplayCompleted = isContractJoinCompleted({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });
    const customerOrgNodeId = findCustomerNodeId({
      customer_id: c.customer_id,
      customer_phone: c.customer_phone ?? null,
    });
    const mergedCustomerMemberId = customerOrgNodeId ? remapMemberId(customerOrgNodeId) : null;
    const mergedInSubtree = mergedCustomerMemberId ? subtreeMemberIds.has(mergedCustomerMemberId) : false;
    const finalOriginId = resolveContractOriginForSubtree(c, subtreeMemberIds);
    const finalInSubtree = subtreeMemberIds.has(finalOriginId);

    let reason: string;
    if (viaCustomerMemberId) {
      reason = primaryInSubtree
        ? 'customer_id→member 매핑 있음, 귀속 id가 서브트리 안'
        : 'customer_id→member 매핑 있으나 귀속 id가 서브트리 밖(상위/타 라인)';
    } else if (primaryInSubtree) {
      reason = '1차 귀속(primary)이 이미 서브트리 안';
    } else if (!salesIsHq) {
      reason = '담당 영업이 HQ가 아님 → 서브트리 밖 담당이면 본 페이지에서 제외';
    } else if (!joinDisplayCompleted) {
      reason = 'HQ 담당이나 가입 완료(표시) 아님 → HQ→고객노드 귀속 시도 안 함';
    } else if (!customerOrgNodeId) {
      reason = '가입 인정인데 조직도에서 고객 customer_id/전화로 노드 매칭 실패';
    } else if (!mergedInSubtree) {
      reason = `고객 노드(${mergedCustomerMemberId})는 찾았으나 내 서브트리에 없음`;
    } else {
      reason = '기타(정상 귀속 가능한데 primary만 subtree 밖이었을 수 있음)';
    }

    return {
      sales_member_id: c.sales_member_id,
      customer_id: c.customer_id,
      via_customer_member_id: viaCustomerMemberId,
      primary_resolved_id: primary,
      primary_in_subtree: primaryInSubtree,
      sales_is_hq: salesIsHq,
      join_display_completed: joinDisplayCompleted,
      customer_org_node_id: customerOrgNodeId,
      merged_customer_member_id: mergedCustomerMemberId,
      merged_in_subtree: mergedInSubtree,
      final_origin_id: finalOriginId,
      final_in_subtree: finalInSubtree,
      reason,
    };
  };

  const remapCustomerMemberId = (customerId: string) =>
    remapMemberId(customerMemberIdByCustomerId.get(customerId) ?? '');

  return {
    remapMemberId,
    resolveContractSalesMemberId,
    resolveContractOriginForSubtree,
    explainContractOriginForSubtree,
    remapCustomerMemberId,
    hqIds,
    membersFiltered,
  };
}
