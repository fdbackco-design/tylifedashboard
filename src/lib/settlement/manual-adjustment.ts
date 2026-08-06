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
