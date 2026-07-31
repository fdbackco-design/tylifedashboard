import {
  happycallYmdSeoul,
  SETTLEMENT_VALID_HAPPYCALL_RESULTS,
} from '@/lib/settlement/settlement-eligibility-v2';
import { resolveHqProductKindFromContract } from '@/lib/settlement/hq-revenue';

/** 더블업 승급 프로모션 — 승급 판정용 인정구좌만 ×2 (수당·보너스·정산에는 미적용) */
export const DOUBLE_UP_PROMOTION_NAME = '더블업 승급 프로모션';

export const DOUBLE_UP_PROMOTION_START_YMD = '2026-06-26';
export const DOUBLE_UP_PROMOTION_END_YMD = '2026-07-31';

const DOUBLE_UP_PROMOTION_START_MS = Date.parse('2026-06-26T00:00:00+09:00');
const DOUBLE_UP_PROMOTION_END_MS = Date.parse('2026-07-31T23:59:59+09:00');

export const DOUBLE_UP_PROMOTION_APPLIED_REASON =
  '더블업 승급 프로모션 기간 내 해피콜 성공 갤럭시케어 계약';

export const DOUBLE_UP_COMMISSION_NOTE =
  '승급 인정구좌는 프로모션으로 2배 적용되었으나, 수당 및 보너스는 실제 계약 구좌 기준으로 계산되었습니다.';

export type DoubleUpPromotionContractRef = {
  unit_count?: number | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  status?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

export type PromotionMultiplier = 1 | 2;

/** 해피콜 성공 여부 (가입 인정·더블업 공통) */
export function isHappyCallSuccessForPromotion(row: {
  status?: string | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
}): boolean {
  if (!happycallYmdSeoul(row.happy_call_at)) return false;
  const status = String(row.status ?? '').trim();
  if (status === '가입') return true;
  const hc = String(row.happycall_result ?? '').trim();
  return SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hc);
}

/**
 * 해피콜 성공 시각이 프로모션 기간(서울) 안인지.
 * 2026-06-26 00:00:00 이상, 2026-07-31 23:59:59 이하.
 */
export function isDoubleUpPromotionWindow(happyCallAt: unknown): boolean {
  if (happyCallAt == null) return false;
  const ymd = happycallYmdSeoul(happyCallAt);
  if (!ymd) return false;
  if (ymd < DOUBLE_UP_PROMOTION_START_YMD || ymd > DOUBLE_UP_PROMOTION_END_YMD) {
    return false;
  }
  if (typeof happyCallAt === 'string' || happyCallAt instanceof Date) {
    const ms = happyCallAt instanceof Date ? happyCallAt.getTime() : Date.parse(String(happyCallAt));
    if (!Number.isNaN(ms)) {
      if (ms < DOUBLE_UP_PROMOTION_START_MS || ms > DOUBLE_UP_PROMOTION_END_MS) {
        return false;
      }
    }
  }
  return true;
}

/** TY갤럭시케어(무·ALL 포함). 라이트·올라이프 등은 제외 */
export function isDoubleUpGalaxyCareProduct(row: DoubleUpPromotionContractRef): boolean {
  return (
    resolveHqProductKindFromContract({
      product_type: row.product_type,
      item_name: row.item_name,
      source_snapshot_json: row.source_snapshot_json,
    }) === 'TY갤럭시케어'
  );
}

export function promotionMultiplierForContract(row: DoubleUpPromotionContractRef): PromotionMultiplier {
  if (!isHappyCallSuccessForPromotion(row)) return 1;
  if (!isDoubleUpPromotionWindow(row.happy_call_at)) return 1;
  if (!isDoubleUpGalaxyCareProduct(row)) return 1;
  return 2;
}

/** 승급 판정 전용 인정 구좌 (실제 구좌 × 배수) */
export function promotionEligibleUnitsForContract(row: DoubleUpPromotionContractRef): number {
  const actual = Math.max(0, row.unit_count ?? 0);
  return actual * promotionMultiplierForContract(row);
}

export type DoubleUpPromotionAudit = {
  actual_unit_count: number;
  double_up_applied: boolean;
  promotion_multiplier: PromotionMultiplier;
  promotion_eligible_unit_count: number;
  happy_call_success_ymd: string | null;
  commission_unit_count: number;
  bonus_unit_count: number;
  applied_reason: string | null;
};

export function buildDoubleUpPromotionAudit(row: DoubleUpPromotionContractRef): DoubleUpPromotionAudit {
  const actual = Math.max(0, row.unit_count ?? 0);
  const multiplier = promotionMultiplierForContract(row);
  return {
    actual_unit_count: actual,
    double_up_applied: multiplier === 2,
    promotion_multiplier: multiplier,
    promotion_eligible_unit_count: actual * multiplier,
    happy_call_success_ymd: happycallYmdSeoul(row.happy_call_at) || null,
    commission_unit_count: actual,
    bonus_unit_count: actual,
    applied_reason: multiplier === 2 ? DOUBLE_UP_PROMOTION_APPLIED_REASON : null,
  };
}
