/**
 * 2026-06 정산 한정 — 2구좌당 5만원 신규 보너스.
 *
 * 조건:
 *  - 계약일이 2026-05-26 ~ 2026-06-10 사이(둘 다 포함)
 *  - 해피콜 일시(happy_call_at) 가 2026-06-12 이전(포함) 이고
 *    해피콜 결과(happycall_result) 가 '성공' / '완료' / '심사완료' / '계약변경' 인 계약만 대상
 *  - (가입일 + 고객명 + 담당사원)로 그룹화한 합산 구좌 수가 2 이상
 *  - 보너스 금액 = floor(합산 구좌 / 2) * 50,000
 *  - 담당자의 직급과 무관하게 동일 금액 적용
 *  - 1구좌만 있는 그룹은 보너스 0원
 *
 * 본 모듈은 유지장려금과 무관하게 독립적으로 계산되며, 호출 측에서 두 값을 합산해
 * `monthly_settlements.incentive_amount` 등에 저장한다.
 */

export const GROUP_BONUS_PER_PAIR_WON = 50_000;
export const GROUP_BONUS_WINDOW_START_YMD = '2026-05-26';
export const GROUP_BONUS_WINDOW_END_YMD = '2026-06-10';
export const GROUP_BONUS_APPLICABLE_YEAR_MONTH = '2026-06';
/** 해피콜 완료 데드라인(YYYY-MM-DD, 포함). 이 날짜 이전까지 해피콜이 끝나야 한다. */
export const GROUP_BONUS_HAPPYCALL_DEADLINE_YMD = '2026-06-12';
/** 해피콜 결과가 이 집합에 속해야 보너스 대상. ('심사완료'는 '완료'와 동일하게 처리) */
export const GROUP_BONUS_VALID_HAPPYCALL_RESULTS: ReadonlySet<string> = new Set([
  '성공',
  '완료',
  '심사완료',
  '계약변경',
]);

export type GroupBonusContractInput = {
  /** 계약 가입일 (YYYY-MM-DD) */
  join_date: string;
  /**
   * 그룹 보너스 가입일 윈도우(5/26~6/10) 판정용 override.
   * 있으면 join_date 대신 사용한다 (정산·실적 join_date 는 그대로).
   */
  group_bonus_join_date?: string | null;
  /** 고객명 (마스킹/접두 제거 등은 호출 측에서 통일해 전달) */
  customer_name: string;
  /** 정산 귀속 담당사원 ID */
  sales_member_id: string;
  /** 계약 구좌 수 */
  unit_count: number;
  /**
   * 해피콜 일시(ISO 또는 YYYY-MM-DD). 비교는 앞 10자리(ymd) 기준.
   * 없거나 GROUP_BONUS_HAPPYCALL_DEADLINE_YMD 이후이면 보너스 대상에서 제외.
   */
  happy_call_at?: string | null;
  /**
   * 해피콜 결과. GROUP_BONUS_VALID_HAPPYCALL_RESULTS 에 속할 때만 보너스 대상.
   */
  happycall_result?: string | null;
};

function normalizeYmd(value: unknown): string {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.slice(0, 10);
}

function normalizeCustomerName(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/^\[고객\]\s*/, '').trim();
}

/**
 * 특정 멤버가 정산월에 받을 그룹 보너스를 계산한다.
 *
 * @param memberId  보너스를 계산할 멤버(담당사원) id
 * @param contracts 정산 대상 계약 후보 (가입일·고객명·담당사원·구좌 포함)
 * @param yearMonth 정산월(YYYY-MM). 적용 월이 아니면 0원.
 */
export function calculateGroupBonusForMember(
  memberId: string,
  contracts: ReadonlyArray<GroupBonusContractInput>,
  yearMonth: string,
): number {
  if (yearMonth !== GROUP_BONUS_APPLICABLE_YEAR_MONTH) return 0;
  if (!memberId) return 0;

  // (가입일|고객명|담당사원) 그룹별 합산 구좌
  const sumByGroup = new Map<string, number>();
  for (const c of contracts) {
    if (!c) continue;
    const salesMemberId = String(c.sales_member_id ?? '').trim();
    if (salesMemberId !== memberId) continue;

    const joinYmd = normalizeYmd(c.group_bonus_join_date ?? c.join_date);
    if (joinYmd < GROUP_BONUS_WINDOW_START_YMD || joinYmd > GROUP_BONUS_WINDOW_END_YMD) continue;

    // 해피콜 추가 조건: 결과는 '성공'/'완료' 이고, 데드라인 이전(포함)에 완료된 계약만.
    const hcResult = String(c.happycall_result ?? '').trim();
    if (!GROUP_BONUS_VALID_HAPPYCALL_RESULTS.has(hcResult)) continue;
    const hcYmd = normalizeYmd(c.happy_call_at);
    if (!hcYmd) continue;
    if (hcYmd > GROUP_BONUS_HAPPYCALL_DEADLINE_YMD) continue;

    const customerName = normalizeCustomerName(c.customer_name);
    if (!customerName) continue; // 고객명 미상은 그룹화 키 불완전 → 제외

    const units = Math.max(0, Number(c.unit_count ?? 0));
    if (units <= 0) continue;

    const key = `${joinYmd}|${customerName}|${salesMemberId}`;
    sumByGroup.set(key, (sumByGroup.get(key) ?? 0) + units);
  }

  // 그룹별 보너스 합계 (1구좌 그룹은 자연스럽게 0)
  let total = 0;
  for (const units of sumByGroup.values()) {
    if (units < 2) continue;
    total += Math.floor(units / 2) * GROUP_BONUS_PER_PAIR_WON;
  }
  return total;
}
