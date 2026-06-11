/**
 * 정산/조직 KPI 대상 계약(SSOT).
 *
 * 핵심 “가입 인정 기준” (2026-06 개정):
 * - status === '가입'
 *   OR (status !== '해약' AND invoice_no 존재)
 *   → 렌탈신청번호(rental_request_no) 보유 여부는 더 이상 따지지 않는다.
 *     해피콜 결과/일시 검증은 정산 계산 본체(v2)에서 정산월 단위로 수행한다.
 *
 * 공통 제외:
 * - is_cancelled = true 제외
 * - status = '취소' 제외
 * - sales_member_id 없음 제외
 * - sales_link_status = 'pending_mapping' 제외 (담당 미확인)
 *
 * NOTE:
 * - `rental_request_no` 필드는 호환을 위해 인터페이스에 남겨두지만 판단에는 사용하지 않는다.
 */
export function isSettlementEligibleContract(c: {
  status: string;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
}): boolean {
  if (c.is_cancelled) return false;
  if (c.status === '취소') return false;
  if (!c.sales_member_id) return false;
  if ((c.sales_link_status ?? 'linked') !== 'linked') return false;

  const inv = (c.invoice_no ?? '').trim();
  return c.status === '가입' || (c.status !== '해약' && inv !== '');
}

