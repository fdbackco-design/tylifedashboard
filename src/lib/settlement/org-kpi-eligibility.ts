/**
 * get_organization_kpis SQL과 동일한 정산/조직 KPI 대상 계약 판별.
 * - is_cancelled = false, status <> 취소, sales_member_id 있음, sales_link_status = linked
 * - status = 가입 OR (status <> 해약 AND 렌탈·송장 번호 존재)
 */
export function isOrganizationKpiEligibleContract(c: {
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
  return (
    c.status === '가입' ||
    (c.status !== '해약' && rental !== '' && inv !== '')
  );
}
