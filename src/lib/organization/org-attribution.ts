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

const toPhoneDigits = (v: string | null | undefined): string =>
  (v ?? '').replace(/\D/g, '');
const normName = (v: string | null | undefined): string =>
  (v ?? '').replace(/^\[고객\]\s*/, '').trim();

export function buildOrgAttributionContext(
  allMembers: AttributionMemberInput[],
): OrgAttributionContext {
  // 안성준은 TY Life 시스템상 영업사원이지만 실제로는 본사로 취급 (page.tsx 와 동일 정책)
  const membersRaw = allMembers.map((m) =>
    m.name === '안성준' ? ({ ...m, rank: '본사' } as AttributionMemberInput) : m,
  );

  // ── customer 노드 ↔ 직원 노드 병합 ──
  const employeesByKey = new Map<string, string>(); // name|phone → memberId
  for (const m of membersRaw) {
    const isCustomerNode = (m.external_id ?? '').startsWith('customer:');
    if (isCustomerNode) continue;
    const digits = toPhoneDigits(m.phone);
    if (!digits) continue;
    const key = `${normName(m.name)}|${digits}`;
    if (!employeesByKey.has(key)) employeesByKey.set(key, m.id);
  }

  const customerMergeTo = new Map<string, string>();
  for (const m of membersRaw) {
    const isCustomerNode = (m.external_id ?? '').startsWith('customer:');
    if (!isCustomerNode) continue;
    const digits = toPhoneDigits(m.phone);
    if (!digits) continue;
    const key = `${normName(m.name)}|${digits}`;
    const employeeId = employeesByKey.get(key);
    if (employeeId) customerMergeTo.set(m.id, employeeId);
  }

  const remapMemberId = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return customerMergeTo.get(id) ?? id;
  };

  // customer_id → effective member id (source_customer_id 우선, external_id=customer:* 보조)
  const customerIdToEffectiveMemberId = new Map<string, string>();
  for (const m of membersRaw) {
    if (m.source_customer_id) {
      customerIdToEffectiveMemberId.set(
        m.source_customer_id,
        (customerMergeTo.get(m.id) ?? m.id),
      );
      continue;
    }
    const ext = m.external_id ?? '';
    if (ext.startsWith('customer:')) {
      const cid = ext.slice('customer:'.length);
      if (!customerIdToEffectiveMemberId.has(cid)) {
        customerIdToEffectiveMemberId.set(cid, customerMergeTo.get(m.id) ?? m.id);
      }
    }
  }

  // members = 병합된 customer 노드 제외
  const members = membersRaw.filter((m) => !customerMergeTo.has(m.id));

  // ── HQ / customer 매핑 (page.tsx 와 동등) ──
  const hqIds = new Set(
    members.filter((m) => m.name === '안성준' || m.rank === '본사').map((m) => m.id),
  );

  const customerNodeByCustomerId = new Map<string, string>();
  const customerMemberIdByCustomerId = new Map<string, string>();
  const nodeIdByPhoneDigits = new Map<string, string>();

  for (const m of members) {
    const ext = m.external_id ?? '';
    if (ext.startsWith('customer:')) {
      const cid = ext.slice('customer:'.length);
      customerNodeByCustomerId.set(cid, m.id);
    }
    const sid = m.source_customer_id ?? null;
    if (sid && m.rank !== '본사') {
      customerMemberIdByCustomerId.set(sid, m.id);
    } else if (ext.startsWith('customer:') && m.rank !== '본사') {
      const cid = ext.slice('customer:'.length);
      if (!customerMemberIdByCustomerId.has(cid)) {
        customerMemberIdByCustomerId.set(cid, m.id);
      }
    }
    const digits = toPhoneDigits(m.phone);
    if (digits) nodeIdByPhoneDigits.set(digits, m.id);
  }

  const effectiveMemberIds = new Set(members.map((m) => m.id));

  const memberNameById = new Map<string, string>(
    members.map((m) => [m.id, normName(m.name)]),
  );
  const memberRankById = new Map<string, string | null>(
    members.map((m) => [m.id, m.rank]),
  );

  const findCustomerNodeIdWithCandidates = (c: AttributionContractInput): {
    pick: string | null;
    candidates: string[];
  } => {
    const candidates: string[] = [];
    if (c.customer_id) {
      const byExt =
        customerIdToEffectiveMemberId.get(c.customer_id) ??
        customerNodeByCustomerId.get(c.customer_id);
      if (byExt) candidates.push(byExt);
    }
    const digits = toPhoneDigits(c.customer_phone);
    if (digits) {
      const byPhone = nodeIdByPhoneDigits.get(digits);
      if (byPhone && !candidates.includes(byPhone)) candidates.push(byPhone);
    }
    return { pick: candidates[0] ?? null, candidates };
  };

  const resolveOrgBasedSalesMember = (
    c: AttributionContractInput,
  ): AttributionResult => {
    // (1) 본인이 고객인 계약 — customer 노드(or 병합된 직원 노드)에 귀속
    if (c.customer_id) {
      const customerMemberId = customerMemberIdByCustomerId.get(c.customer_id) ?? null;
      if (customerMemberId) {
        const mapped = customerMergeTo.get(customerMemberId) ?? customerMemberId;
        // 추가 후보가 있는지(phone 등) 점검해 모호성 표기
        const { candidates: extraCandidates } = findCustomerNodeIdWithCandidates(c);
        const merged = new Set<string>([mapped, ...extraCandidates.map((x) => customerMergeTo.get(x) ?? x)]);
        merged.delete('');
        return {
          org_based_sales_member_id: mapped,
          decision: 'customer_node',
          candidates: [...merged],
        };
      }
    }

    // (2) HQ 담당 + 가입 인정 → customer 노드로 치환
    const joinEligible = isContractJoinCompleted({
      status: c.status ?? '',
      rental_request_no: c.rental_request_no,
      invoice_no: c.invoice_no,
      memo: c.memo,
    });
    if (
      c.sales_member_id &&
      hqIds.size > 0 &&
      hqIds.has(c.sales_member_id) &&
      joinEligible
    ) {
      const { pick, candidates } = findCustomerNodeIdWithCandidates(c);
      if (pick) {
        const mapped = customerMergeTo.get(pick) ?? pick;
        const decision: AttributionDecision =
          candidates.length > 1 ? 'ambiguous' : 'hq_customer_node';
        return {
          org_based_sales_member_id: mapped,
          decision,
          candidates: candidates.map((x) => customerMergeTo.get(x) ?? x),
        };
      }
      // HQ 인데 customer 매핑이 없으면 HQ 그대로 두는 게 page.tsx 의 fallthrough 동작
    }

    // (3) fallback: sales_member_id 그대로(병합 매핑은 통과)
    if (c.sales_member_id) {
      const mapped = customerMergeTo.get(c.sales_member_id) ?? c.sales_member_id;
      if (effectiveMemberIds.has(mapped)) {
        return {
          org_based_sales_member_id: mapped,
          decision: 'sales_member_id',
          candidates: [mapped],
        };
      }
      // 매핑된 결과가 유효 멤버 풀에 없으면 → not_found
      return { org_based_sales_member_id: null, decision: 'not_found', candidates: [] };
    }
    return { org_based_sales_member_id: null, decision: 'not_found', candidates: [] };
  };

  return {
    remapMemberId,
    resolveOrgBasedSalesMember,
    memberNameById,
    memberRankById,
    effectiveMemberIds,
  };
}
