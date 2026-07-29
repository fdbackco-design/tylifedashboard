/**
 * "조직도 기준 담당자" 계산 모듈
 * ──────────────────────────────────────────────────────────────────────────────
 * 본 모듈은 /admin/organization 페이지에서 contractsByMember 를 구성할 때 사용하는
 * 매핑 로직(mapSalesMemberForOrg + customer 노드 병합 + HQ 예외 + phone fallback)을
 * "정산 담당자 자동 보정" API 에서도 동일하게 재현하기 위해 추출/독립 구현한 것이다.
 *
 *   page.tsx 의 동작은 단 한 글자도 바꾸지 않는다.
 *   ─ 이 파일은 신규 추가일 뿐, 페이지는 import 하지 않는다.
 *   ─ 향후 페이지 매핑 정책이 변경되면 본 파일도 함께 동기화해야 한다.
 *
 * 입력
 *   - allMembers     : organization_members 전체(id, name, rank, phone, external_id, source_customer_id)
 *   - contracts      : contracts(+ customers join) 전체
 *
 * 출력
 *   resolveOrgBasedSalesMember(contract) → {
 *     org_based_sales_member_id: string | null,
 *     decision: 'customer_node' | 'hq_customer_node' | 'phone_fallback' | 'sales_member_id' | 'ambiguous' | 'not_found',
 *     candidates: string[]   // 모호한 경우 가능한 후보들(2개 이상)
 *   }
 */

import { isContractJoinCompleted } from '@/lib/utils/contract-display-status';
import {
  buildOrgContractSalesRemap,
  type OrgMemberForContractRemap,
} from '@/lib/organization/org-contract-sales-remap';

export type AttributionMemberInput = {
  id: string;
  name: string | null;
  rank: string | null;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
};

export type AttributionContractInput = {
  id: string;
  contract_code: string | null;
  sales_member_id: string | null;
  customer_id: string | null;
  status: string | null;
  rental_request_no: string | null;
  invoice_no: string | null;
  memo: string | null;
  customer_phone: string | null;
  customer_name: string | null;
  customer_birth_date: string | null;
};

export type AttributionDecision =
  | 'customer_node'
  | 'hq_customer_node'
  | 'phone_fallback'
  | 'sales_member_id'
  | 'ambiguous'
  | 'not_found';

export type AttributionResult = {
  org_based_sales_member_id: string | null;
  decision: AttributionDecision;
  candidates: string[];
};

export type OrgAttributionContext = {
  /** customer 노드 → 직원 노드로의 병합 결과 (page.tsx 의 remapMemberId 와 동등) */
  remapMemberId: (id: string | null | undefined) => string | null;
  /** 어떤 contract 에 대해 조직도 기준 담당자를 계산 */
  resolveOrgBasedSalesMember: (c: AttributionContractInput) => AttributionResult;
  /** id → 표시명 */
  memberNameById: ReadonlyMap<string, string>;
  /** id → rank */
  memberRankById: ReadonlyMap<string, string | null>;
  /** 유효 member id 집합 (병합된 customer 노드는 제외) */
  effectiveMemberIds: ReadonlySet<string>;
};

const normName = (v: string | null | undefined): string =>
  (v ?? '').replace(/^\[고객\]\s*/, '').trim();

export function buildOrgAttributionContext(
  allMembers: AttributionMemberInput[],
  customerBirthDateById: ReadonlyMap<string, string | null> = new Map(),
): OrgAttributionContext {
  const membersRaw = allMembers.map((m) =>
    m.name === '안성준' ? ({ ...m, rank: '본사' } as AttributionMemberInput) : m,
  );
  const shared = buildOrgContractSalesRemap(
    membersRaw as OrgMemberForContractRemap[],
    customerBirthDateById,
  );
  const remapMemberId = (id: string | null | undefined): string | null =>
    id ? shared.remapMemberId(id) : null;
  const members = shared.membersFiltered as AttributionMemberInput[];
  const effectiveMemberIds = new Set(members.map((m) => m.id));

  const memberNameById = new Map<string, string>(
    members.map((m) => [m.id, normName(m.name)]),
  );
  const memberRankById = new Map<string, string | null>(
    members.map((m) => [m.id, m.rank]),
  );

  const resolveOrgBasedSalesMember = (
    c: AttributionContractInput,
  ): AttributionResult => {
    const joinEligible = isContractJoinCompleted({
      status: c.status ?? '',
      rental_request_no: c.rental_request_no,
      invoice_no: c.invoice_no,
      memo: c.memo,
    });
    if (!c.sales_member_id || !c.customer_id) {
      return { org_based_sales_member_id: null, decision: 'not_found', candidates: [] };
    }
    const mapped = shared.resolveContractSalesMemberId({
      sales_member_id: c.sales_member_id,
      customer_id: c.customer_id,
      status: c.status ?? '',
      rental_request_no: c.rental_request_no,
      invoice_no: c.invoice_no,
      memo: c.memo,
      customer_phone: c.customer_phone,
      customer_name: c.customer_name,
      customer_birth_date: c.customer_birth_date,
      contract_code: c.contract_code,
    });
    if (!effectiveMemberIds.has(mapped)) {
      return { org_based_sales_member_id: null, decision: 'not_found', candidates: [] };
    }
    const originalMapped = shared.remapMemberId(c.sales_member_id);
    const decision: AttributionDecision =
      mapped === originalMapped
        ? 'sales_member_id'
        : shared.hqIds.has(c.sales_member_id) && joinEligible
          ? 'hq_customer_node'
          : 'customer_node';
    return { org_based_sales_member_id: mapped, decision, candidates: [mapped] };
  };

  return {
    remapMemberId,
    resolveOrgBasedSalesMember,
    memberNameById,
    memberRankById,
    effectiveMemberIds,
  };
}
