import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import {
  getContractDisplayStatus,
  isContractJoinCompleted as isJoinCompleted,
} from '@/lib/utils/contract-display-status';

/** 조직도 계약 맵(OrgTree / 서버 페이지 공통) */
export interface ContractItem {
  id: string;
  contract_code: string;
  join_date: string | null;
  happy_call_at?: string | null;
  product_type: string | null;
  item_name?: string | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
  status: string;
  unit_count: number | null;
  customer_name: string;
  /** 계약 담당 조직원 표시명 */
  sales_member_name?: string;
}

const CARD_STATUSES = ['준비', '대기', '해약', '가입'] as const;
export type OrgTreeCardStatus = (typeof CARD_STATUSES)[number];

/** id로 서브트리(자신 포함) member id 목록 */
export function collectSubtreeIds(node: OrgTreeNodeType): string[] {
  return [node.id, ...node.children.flatMap(collectSubtreeIds)];
}

export function countCompleted(ids: string[], map: Record<string, ContractItem[]>): number {
  return ids.reduce(
    (sum, id) => sum + (map[id] ?? []).filter(isJoinCompleted).length,
    0,
  );
}

export function sumJoinUnits(ids: string[], map: Record<string, ContractItem[]>): number {
  let sum = 0;
  for (const id of ids) {
    for (const c of map[id] ?? []) {
      if (!isJoinCompleted(c)) continue;
      sum += Math.max(0, Number(c.unit_count ?? 0));
    }
  }
  return sum;
}

export function countByStatus(
  ids: string[],
  map: Record<string, ContractItem[]>,
): Record<OrgTreeCardStatus, number> {
  const counts: Record<OrgTreeCardStatus, number> = { 준비: 0, 대기: 0, 해약: 0, 가입: 0 };
  for (const id of ids) {
    for (const c of map[id] ?? []) {
      if (isJoinCompleted(c)) {
        counts.가입 += 1;
        continue;
      }
      if (
        getContractDisplayStatus({
          status: c.status,
          rental_request_no: c.rental_request_no ?? null,
          invoice_no: c.invoice_no ?? null,
          memo: c.memo ?? null,
        }) === '렌탈 미충족'
      ) {
        continue;
      }
      const st = String(c.status ?? '').trim();
      const bucket: OrgTreeCardStatus =
        st === '해약' ? '해약' : st === '대기' ? '대기' : st === '준비' ? '준비' : '준비';
      counts[bucket] += 1;
    }
  }
  return counts;
}
