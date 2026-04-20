import { isOrgDisplayHiddenMemberName } from '@/lib/organization/org-display-hidden';

const ZERO_OUT_MEMBER_NAME = '정성은';

/**
 * 대시보드 등에서 사용: 해당 월 `monthly_settlements.total_amount` 합계.
 * 정산 재계산 API와 동일 스냅샷을 쓰며, 정산 현황과 동일하게 일부 멤버는 제외한다.
 */
export async function calculateSettlementTotalAmountForYearMonth(db: any, yearMonth: string): Promise<number> {
  const { data: rows, error } = await db
    .from('monthly_settlements')
    .select(
      `
      total_amount,
      organization_members ( name )
    `,
    )
    .eq('year_month', yearMonth);

  if (error) throw new Error(error.message);

  let total = 0;
  for (const r of rows ?? []) {
    const name = String((r as { organization_members?: { name?: string } | null }).organization_members?.name ?? '');
    if (name === ZERO_OUT_MEMBER_NAME) continue;
    if (name.replace(/^\[고객\]\s*/, '').trim() === '안성준') continue;
    if (isOrgDisplayHiddenMemberName(name)) continue;
    total += Number((r as { total_amount?: number }).total_amount ?? 0);
  }

  return total;
}
