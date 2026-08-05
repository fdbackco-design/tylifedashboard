import type { RankType } from '@/lib/types/organization';
import { isTyCarePlanContract } from '@/lib/settlement/galaxy-care-mu';

/**
 * 물품명(또는 상품유형)별 직급 수당 단가.
 * 해당 시 settlement_rules / 기본 직급 단가 대신 적용한다.
 */

export type ProductCommissionKind = 'sun_cruise_or_special' | 'all_life' | 'care_plan_zero';

export type ProductCommissionRef = {
  item_name?: string | null;
  product_type?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

/** TY썬크루즈 · TY스페셜라이프케어 */
export const SUN_CRUISE_SPECIAL_COMMISSION_BY_RANK: Partial<Record<RankType, number>> = {
  영업사원: 250_000,
  리더: 300_000,
  센터장: 350_000,
  사업본부장: 400_000,
};

/** TY올라이프케어 */
export const ALL_LIFE_COMMISSION_BY_RANK: Partial<Record<RankType, number>> = {
  영업사원: 250_000,
  리더: 350_000,
  센터장: 420_000,
  사업본부장: 450_000,
};

function collectProductTexts(ref: ProductCommissionRef): string[] {
  return [ref.item_name, ref.product_type, ref.source_snapshot_json?.['상품명']]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
}

/** 물품명·상품유형으로 수당 상품군 판별 (케어플랜 0원 → 썬크루즈/스페셜 → 올라이프) */
export function resolveProductCommissionKind(
  ref: ProductCommissionRef | null | undefined,
): ProductCommissionKind | null {
  if (!ref) return null;
  if (isTyCarePlanContract(ref)) return 'care_plan_zero';

  const texts = collectProductTexts(ref);
  if (texts.length === 0) return null;

  for (const t of texts) {
    if (t.includes('TY썬크루즈') || t.includes('썬크루즈')) return 'sun_cruise_or_special';
    if (t.includes('TY스페셜라이프케어') || t.includes('스페셜라이프케어')) {
      return 'sun_cruise_or_special';
    }
  }
  for (const t of texts) {
    if (t.includes('TY올라이프케어') || t.includes('올라이프케어')) return 'all_life';
  }
  return null;
}

export function getProductCommissionPerUnit(
  kind: ProductCommissionKind,
  rank: RankType,
): number | null {
  if (kind === 'care_plan_zero') return 0;
  const table =
    kind === 'sun_cruise_or_special'
      ? SUN_CRUISE_SPECIAL_COMMISSION_BY_RANK
      : ALL_LIFE_COMMISSION_BY_RANK;
  const v = table[rank];
  return typeof v === 'number' ? v : null;
}

/**
 * 물품명 수당 단가. 해당 없으면 null → 호출부가 settlement_rules 폴백.
 * TY케어플랜은 전 직급 0원.
 */
export function productCommissionPerUnitForRank(
  rank: RankType,
  ref: ProductCommissionRef | null | undefined,
): number | null {
  if (rank === '본사') return null;
  const kind = resolveProductCommissionKind(ref);
  if (!kind) return null;
  return getProductCommissionPerUnit(kind, rank);
}
