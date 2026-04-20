import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  buildChildrenByParentFromRows,
  collectSubtreeMemberIdsDownstream,
} from '@/lib/settlement/settlement-org-tree';

/** 리더 승격/유지 판정에 쓰는 '가입' 계약만 (status === 가입, 귀속된 담당자 기준) */
export type AttributedJoinContractRow = {
  id: string;
  join_date: string; // YYYY-MM-DD
  unit_count: number;
  sales_member_id: string;
};

/**
 * 산하 가입 계약을 (가입일 → 계약 id) 순으로 쌓을 때,
 * 누적 구좌가 처음 20 이상이 되는 그 계약(승격 계약).
 * 같은 가입일이 여러 건이면 id 문자열 순으로 순서를 정한다.
 */
export type SalesMemberPromotionThreshold = {
  threshold_contract_id: string;
  threshold_join_date: string;
};

/**
 * 계약 c가 승격 계약 이후(동일 가입일이면 id가 승격 계약 id 이상)인지.
 * 이때부터 직급 단가를 리더(40만)로 본다.
 */
export function isContractAtOrAfterPromotionThreshold(
  contractJoinDate: string,
  contractId: string,
  threshold: SalesMemberPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  const aj = contractJoinDate.slice(0, 10);
  const tj = threshold.threshold_join_date;
  if (aj > tj) return true;
  if (aj < tj) return false;
  return contractId.localeCompare(threshold.threshold_contract_id) >= 0;
}

/**
 * 계약 c가 승격 계약 "다음" 계약부터(엄밀히 after) 리더 단가를 적용해야 하는 경우에 사용.
 * - 승격 계약 자체(threshold_contract_id)는 승격 전(영업사원 단가)으로 본다.
 */
export function isContractStrictlyAfterPromotionThreshold(
  contractJoinDate: string,
  contractId: string,
  threshold: SalesMemberPromotionThreshold | null,
): boolean {
  if (!threshold) return false;
  const aj = contractJoinDate.slice(0, 10);
  const tj = threshold.threshold_join_date;
  if (aj > tj) return true;
  if (aj < tj) return false;
  return contractId.localeCompare(threshold.threshold_contract_id) > 0;
}

/**
 * 영업사원별: 본인 산하 '가입' 누적 구좌가 20 이상이 되는 순간의 **승격 계약**(날짜만이 아니라 계약 단위).
 */
export function computeSalesMemberPromotionThreshold(
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  rankById: Map<string, RankType>,
): Map<string, SalesMemberPromotionThreshold | null> {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const sorted = [...joinContractsAttributed].sort((a, b) => {
    const d = a.join_date.slice(0, 10).localeCompare(b.join_date.slice(0, 10));
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });

  const out = new Map<string, SalesMemberPromotionThreshold | null>();
  for (const [id, rank] of rankById) {
    if (rank !== '영업사원') continue;
    const subtree = collectSubtreeMemberIdsDownstream(id, childrenByParent);
    let cum = 0;
    let promo: SalesMemberPromotionThreshold | null = null;
    for (const c of sorted) {
      if (!subtree.has(c.sales_member_id)) continue;
      cum += Math.max(0, c.unit_count ?? 0);
      if (cum >= 20) {
        promo = {
          threshold_contract_id: c.id,
          threshold_join_date: c.join_date.slice(0, 10),
        };
        break;
      }
    }
    out.set(id, promo);
  }
  return out;
}

/** @deprecated 날짜만으로는 같은 일자 계약을 구분할 수 없음 — computeSalesMemberPromotionThreshold 사용 */
export function computeSalesMemberPromotionFirstJoinDate(
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  rankById: Map<string, RankType>,
): Map<string, string | null> {
  const th = computeSalesMemberPromotionThreshold(treeRows, joinContractsAttributed, rankById);
  const out = new Map<string, string | null>();
  for (const [k, v] of th) {
    out.set(k, v?.threshold_join_date ?? null);
  }
  return out;
}

/** 정산월 말(25일) 시점까지 누적된 산하 '가입' 구좌 합 (해당 일자 포함) */
export function subtreeJoinUnitsJoinOnlyAsOf(
  memberId: string,
  treeRows: OrgTreeRow[],
  joinContractsAttributed: AttributedJoinContractRow[],
  asOfInclusive: string,
): number {
  const childrenByParent = buildChildrenByParentFromRows(treeRows);
  const subtree = collectSubtreeMemberIdsDownstream(memberId, childrenByParent);
  const cap = asOfInclusive.slice(0, 10);
  let sum = 0;
  for (const c of joinContractsAttributed) {
    if (!subtree.has(c.sales_member_id)) continue;
    const jd = c.join_date.slice(0, 10);
    if (jd <= cap) sum += Math.max(0, c.unit_count ?? 0);
  }
  return sum;
}

export function isLeaderMaintenanceBonusEligible(params: {
  memberDbRank: RankType;
  promotionThreshold: SalesMemberPromotionThreshold | null;
  subtreeJoinUnitsAsOf25: number;
}): boolean {
  if (params.memberDbRank !== '영업사원') return false;
  if (!params.promotionThreshold) return false;
  return params.subtreeJoinUnitsAsOf25 >= 20;
}
