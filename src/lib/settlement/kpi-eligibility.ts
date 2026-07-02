import { hasValidInvoiceNo } from '@/lib/utils/invoice-no';

/**
 * get_organization_kpis SQL 함수와 동일한 가입 인정·KPI 집계 조건.
 * 본사 매출 합계는 이 기준으로 대상 계약을 선별한다.
 */
export type OrganizationKpiContractInput = {
  status: string;
  is_cancelled?: boolean | null;
  sales_member_id?: string | null;
  sales_link_status?: string | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
};

function trimOrEmpty(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function isOrganizationKpiEligibleContract(c: OrganizationKpiContractInput): boolean {
  if (c.is_cancelled) return false;
  if (c.status === '취소') return false;
  if (!c.sales_member_id) return false;
  if ((c.sales_link_status ?? 'linked') !== 'linked') return false;

  if (c.status === '가입') return true;

  return (
    c.status !== '해약' &&
    trimOrEmpty(c.rental_request_no) !== '' &&
    hasValidInvoiceNo(c.invoice_no)
  );
}
