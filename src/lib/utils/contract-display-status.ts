/**
 * 계약 목록/조직도/상세 등에서 동일한 기준으로 “표시 상태”를 맞춘다.
 * - 렌탈기준 미충족(준비·대기)은 최우선
 * - 해약이 아니고 송장번호·렌탈신청번호가 모두 있으면 가입으로 표시
 * - 그 외에는 DB status 그대로
 */
export type ContractDisplayStatusInput = {
  status: string;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
};

export function getContractDisplayStatus(c: ContractDisplayStatusInput): string {
  const v = (c.rental_request_no ?? c.memo ?? '').trim();
  if ((c.status === '준비' || c.status === '대기') && v === '렌탈기준 미충족') {
    return '렌탈 미충족';
  }
  const hasRental = (c.rental_request_no ?? '').trim().length > 0;
  const hasInvoice = (c.invoice_no ?? '').trim().length > 0;
  if (c.status === '가입' || (c.status !== '해약' && hasRental && hasInvoice)) {
    return '가입';
  }
  return c.status;
}

/** 집계용: 화면상 “가입 완료”로 볼 수 있는지 */
export function isContractJoinCompleted(c: ContractDisplayStatusInput): boolean {
  return getContractDisplayStatus(c) === '가입';
}
