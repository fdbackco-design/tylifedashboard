/**
 * 정산/조직 KPI 대상 계약(SSOT).
 *
 * 핵심 “가입 인정 기준”:
 * - status === '가입'
 *   OR (status !== '해약' AND rental_request_no + invoice_no 존재)
 *
 * 공통 제외:
 * - is_cancelled = true 제외
 * - status = '취소' 제외
 * - sales_member_id 없음 제외
 * - sales_link_status = 'pending_mapping' 제외 (담당 미확인)
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

  const rental = (c.rental_request_no ?? '').trim();
  const inv = (c.invoice_no ?? '').trim();
  return c.status === '가입' || (c.status !== '해약' && rental !== '' && inv !== '');
}

