/**
 * 월정산 수동 가감(환수·예외).
 * 재계산 시에도 동일하게 적용되도록 member_id + year_month 키로 고정한다.
 */

export type SettlementManualAdjustment = {
  amount_won: number;
  reason: string;
};

/** 조이찬: TY271/TY272 청약철회 기지급(6월) 30만×2 환수 */
const JO_YI_CHAN_MEMBER_ID = '40605438-9fc8-4dac-acda-f8b37c3add5b';

const ADJUSTMENTS: ReadonlyArray<{
  member_id: string;
  year_month: string;
  amount_won: number;
  reason: string;
}> = [
  {
    member_id: JO_YI_CHAN_MEMBER_ID,
    year_month: '2026-07',
    amount_won: -600_000,
    reason: 'TY27120260612·TY27220260612 청약철회 기지급 수당 환수(-60만원)',
  },
];

export function getSettlementManualAdjustment(
  memberId: string,
  yearMonth: string,
): SettlementManualAdjustment | null {
  const hit = ADJUSTMENTS.find(
    (r) => r.member_id === memberId && r.year_month === yearMonth,
  );
  if (!hit || hit.amount_won === 0) return null;
  return { amount_won: hit.amount_won, reason: hit.reason };
}

function normalizeClawbackWon(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw));
}

/**
 * 표시·차감용 환수금(원, 항상 0 이상).
 * - DB 값(NULL 아님)이 있으면 그 금액
 * - 없으면 코드 고정 예외 환수(음수 가감의 절댓값)
 */
export function resolveClawbackWon(
  memberId: string,
  yearMonth: string,
  dbClawbackAmount: number | null | undefined,
): number {
  if (dbClawbackAmount != null && Number.isFinite(Number(dbClawbackAmount))) {
    return normalizeClawbackWon(Number(dbClawbackAmount));
  }
  const adj = getSettlementManualAdjustment(memberId, yearMonth);
  if (adj && adj.amount_won < 0) return Math.round(-adj.amount_won);
  return 0;
}

/**
 * 합계에 더할 부호 있는 가감(환수는 음수).
 * 재계산과 저장 직후 total_amount 패치에 동일하게 쓴다.
 */
export function resolveManualAdjustmentWon(
  memberId: string,
  yearMonth: string,
  dbClawbackAmount: number | null | undefined,
): SettlementManualAdjustment | null {
  if (dbClawbackAmount != null && Number.isFinite(Number(dbClawbackAmount))) {
    const clawback = normalizeClawbackWon(Number(dbClawbackAmount));
    if (clawback === 0) return null;
    return { amount_won: -clawback, reason: '수동 환수금' };
  }
  return getSettlementManualAdjustment(memberId, yearMonth);
}

/** 개인+오버라이드+보너스 합계에서 환수금을 뺀 지급 합계 */
export function netPayoutAfterClawback(
  personalCommission: number,
  overrideAmount: number,
  bonusAmount: number,
  clawbackWon: number,
): number {
  const gross =
    (Number(personalCommission) || 0) +
    (Number(overrideAmount) || 0) +
    (Number(bonusAmount) || 0);
  return gross - (Number(clawbackWon) || 0);
}
