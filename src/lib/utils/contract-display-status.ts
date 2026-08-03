/**
 * 계약 목록/조직도/상세 등에서 동일한 기준으로 “표시 상태”를 맞춘다.
 * - 취소·청약 철회·해약 등 종료 상태는 송장번호가 있어도 그대로 표시한다.
 * - 렌탈기준 미충족(준비·대기)은 최우선
 * - 2026-06 개정: 해약이 아니고 송장번호가 있으면 가입으로 표시한다.
 *   (렌탈신청번호 유무는 더 이상 따지지 않는다.)
 * - TY갤럭시케어_무 · TY케어플랜: 송장 없이 해피콜 성공이면 가입으로 표시
 * - 그 외에는 DB status 그대로
 */
import { hasValidInvoiceNo } from '@/lib/utils/invoice-no';
import {
  isInvoiceExemptHappyCallJoinContract,
  meetsInvoiceExemptHappyCallJoinCondition,
} from '@/lib/settlement/galaxy-care-mu';

export type ContractDisplayStatusInput = {
  status: string;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  happy_call_at?: unknown;
  happycall_result?: string | null;
  is_cancelled?: boolean | null;
};

export function getContractDisplayStatus(c: ContractDisplayStatusInput): string {
  const status = String(c.status ?? '').trim();
  const compactStatus = status.replace(/\s+/g, '');

  // 종료 상태가 송장번호 존재 여부 때문에 '가입'으로 덮어써지지 않도록 최우선 처리한다.
  if (compactStatus === '청약철회') return '청약철회';
  if (status === '취소' || status === '해약' || status === '계약취소') return status;

  const v = (c.rental_request_no ?? c.memo ?? '').trim();
  if ((status === '준비' || status === '대기') && v === '렌탈기준 미충족') {
    return '렌탈 미충족';
  }
  const hasInvoice = hasValidInvoiceNo(c.invoice_no);
  if (status === '가입' || hasInvoice) {
    return '가입';
  }
  if (
    isInvoiceExemptHappyCallJoinContract(c) &&
    meetsInvoiceExemptHappyCallJoinCondition(c)
  ) {
    return '가입';
  }
  return status;
}

/** 집계용: 화면상 “가입 완료”로 볼 수 있는지 */
export function isContractJoinCompleted(c: ContractDisplayStatusInput): boolean {
  return getContractDisplayStatus(c) === '가입';
}
