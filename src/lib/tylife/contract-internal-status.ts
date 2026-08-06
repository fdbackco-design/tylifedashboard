/**
 * TY 동기화: TY 원본 상태(ty_source_status) vs 내부 운영 상태(status) 분리·판정.
 *
 * 가입(내부 status=가입) 조건:
 *   - 해피콜 결과 ∈ 정산 v2 유효 결과(성공/완료/심사완료/계약변경)
 *   - 유효 송장번호 존재
 *   - 취소/해약/반품 등 종료 상태 아님
 *   ※ 렌탈신청번호는 사용하지 않음
 *   ※ TY갤럭시케어_무 · TY케어플랜 은 송장 없이 해피콜만으로 가입
 *   ※ TY스페셜라이프케어 는 송장에 '설치완료' 포함 시 숫자 송장과 동일하게 인정
 */
import type { ContractInsert, ContractStatus } from '../types/contract';
import { hasJoinSatisfyingInvoiceNo, hasValidInvoiceNo } from '../utils/invoice-no';
import {
  isInvoiceExemptHappyCallJoinContract,
  meetsInvoiceExemptHappyCallJoinCondition,
  resolveHappycallEligibilityFields,
} from '../settlement/galaxy-care-mu';
import { SETTLEMENT_VALID_HAPPYCALL_RESULTS } from '../settlement/settlement-eligibility-v2';
import { DEFAULT_ITEM_NAME_PLACEHOLDER } from './normalize';

/**
 * 운영에서 강제 취소 고정한 계약 코드.
 * TY 원본이 가입/준비여도 sync·정산에서 취소로 유지한다.
 * (수동 취소 후 sync가 다시 가입으로 되돌린 케이스 방어)
 */
export const FORCE_CANCELLED_CONTRACT_CODES: ReadonlySet<string> = new Set([
  'TY12820260716',
  'TY12720260716',
  'TY05120260718',
  'TY05020260718',
  'TY01020260719',
  'TY00920260719',
]);

export function isForceCancelledContractCode(contractCode: string | null | undefined): boolean {
  const code = String(contractCode ?? '').trim();
  return code.length > 0 && FORCE_CANCELLED_CONTRACT_CODES.has(code);
}

const TY_SIMPLE_PROGRESS_STATUSES: ReadonlySet<ContractStatus> = new Set([
  '준비',
  '대기',
  '상담중',
  '해피콜완료',
  '배송준비',
  '배송완료',
  '정산완료',
]);

const TY_TERMINAL_RAW_KEYWORDS = ['해지', '철회', '무효', '반품', '취소', '해약'] as const;

export type ExistingContractMergeSource = {
  status: ContractStatus;
  ty_source_status?: ContractStatus | null;
  invoice_no: string | null;
  rental_request_no: string | null;
  item_name: string | null;
  happycall_result: string | null;
  happy_call_at?: string | null;
  is_cancelled?: boolean | null;
};

export function isTySimpleProgressStatus(status: ContractStatus): boolean {
  return TY_SIMPLE_PROGRESS_STATUSES.has(status);
}

export function isTyTerminalClose(params: {
  tySourceStatus: ContractStatus;
  isCancelled: boolean;
  tyStatusRaw?: string | null;
}): boolean {
  if (params.isCancelled) return true;
  if (params.tySourceStatus === '취소' || params.tySourceStatus === '해약') return true;
  const raw = (params.tyStatusRaw ?? '').trim();
  if (!raw) return false;
  return TY_TERMINAL_RAW_KEYWORDS.some((kw) => raw.includes(kw));
}

export function resolveTerminalInternalStatus(params: {
  tySourceStatus: ContractStatus;
  isCancelled: boolean;
  tyStatusRaw?: string | null;
}): ContractStatus {
  const raw = (params.tyStatusRaw ?? '').trim();
  if (params.tySourceStatus === '해약' || raw.includes('해지')) return '해약';
  if (params.isCancelled || params.tySourceStatus === '취소' || raw.includes('반품')) return '취소';
  if (raw.includes('철회') || raw.includes('무효')) return '취소';
  return '취소';
}

export function meetsInternalJoinCondition(params: {
  invoice_no: string | null | undefined;
  happycall_result: string | null | undefined;
  happy_call_at?: unknown;
  is_cancelled?: boolean | null;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
}): boolean {
  if (params.is_cancelled) return false;
  if (isInvoiceExemptHappyCallJoinContract(params)) {
    return meetsInvoiceExemptHappyCallJoinCondition(params);
  }
  // TY스페셜라이프케어: 숫자 송장 또는 송장에 '설치완료' 포함 시 충족
  if (
    !hasJoinSatisfyingInvoiceNo(params.invoice_no, {
      product_type: params.product_type,
      item_name: params.item_name,
      source_snapshot_json: params.source_snapshot_json,
    })
  ) {
    return false;
  }
  const { result: hc } = resolveHappycallEligibilityFields(
    params.happy_call_at,
    params.happycall_result,
  );
  return SETTLEMENT_VALID_HAPPYCALL_RESULTS.has(hc);
}

/**
 * TY 리스트/상세 + 기존 DB 값을 병합한 뒤 내부 운영 status 를 결정한다.
 */
export function resolveInternalContractStatus(params: {
  tySourceStatus: ContractStatus;
  tyStatusRaw?: string | null;
  isCancelled: boolean;
  existingInternalStatus: ContractStatus | null;
  invoice_no: string | null | undefined;
  happycall_result: string | null | undefined;
  happy_call_at?: unknown;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
  contractCode?: string | null;
}): ContractStatus {
  if (isForceCancelledContractCode(params.contractCode)) {
    return '취소';
  }

  const tyTerminal = isTyTerminalClose({
    tySourceStatus: params.tySourceStatus,
    isCancelled: params.isCancelled,
    tyStatusRaw: params.tyStatusRaw,
  });

  if (tyTerminal) {
    return resolveTerminalInternalStatus({
      tySourceStatus: params.tySourceStatus,
      isCancelled: params.isCancelled,
      tyStatusRaw: params.tyStatusRaw,
    });
  }

  // 수동 취소/해약 보존: TY 원본이 종료가 아니어도 DB에 이미 취소·해약이면 유지
  if (
    params.existingInternalStatus === '취소' ||
    params.existingInternalStatus === '해약'
  ) {
    return params.existingInternalStatus;
  }

  if (
    meetsInternalJoinCondition({
      invoice_no: params.invoice_no,
      happycall_result: params.happycall_result,
      happy_call_at: params.happy_call_at,
      is_cancelled: params.isCancelled,
      product_type: params.product_type,
      item_name: params.item_name,
      source_snapshot_json: params.source_snapshot_json,
    })
  ) {
    return '가입';
  }

  // 가입 다운그레이드 금지: 이미 가입이고 TY 가 단순 진행 상태면 유지
  if (
    params.existingInternalStatus === '가입' &&
    isTySimpleProgressStatus(params.tySourceStatus)
  ) {
    return '가입';
  }

  return params.tySourceStatus;
}

/** 동기화 upsert 직전: 리스트/상세 값이 비어 있으면 기존 DB 값을 보존 */
export function mergeExistingContractFields(
  incoming: ContractInsert,
  existing: ExistingContractMergeSource | null,
): ContractInsert {
  if (!existing) return incoming;

  let merged: ContractInsert = { ...incoming };

  if (!hasValidInvoiceNo(merged.invoice_no) && hasValidInvoiceNo(existing.invoice_no)) {
    merged = { ...merged, invoice_no: existing.invoice_no };
  }
  if (!(merged.rental_request_no ?? '').trim() && (existing.rental_request_no ?? '').trim()) {
    merged = { ...merged, rental_request_no: existing.rental_request_no };
  }
  if (!(merged.happycall_result ?? '').trim() && (existing.happycall_result ?? '').trim()) {
    merged = { ...merged, happycall_result: existing.happycall_result };
  }
  if (!merged.happy_call_at && existing.happy_call_at) {
    merged = { ...merged, happy_call_at: existing.happy_call_at };
  }
  if (
    (merged.item_name ?? null) === DEFAULT_ITEM_NAME_PLACEHOLDER &&
    (existing.item_name ?? null) != null &&
    existing.item_name !== DEFAULT_ITEM_NAME_PLACEHOLDER
  ) {
    merged = { ...merged, item_name: existing.item_name ?? undefined };
  }

  // 수동 취소 보존: DB is_cancelled=true 인데 TY 리스트가 아직 취소를 안 주면 유지
  if (existing.is_cancelled === true && !merged.is_cancelled) {
    merged = { ...merged, is_cancelled: true };
  }

  return merged;
}

export function isEligibleForHqCustomerAttribution(params: {
  status: string;
  is_cancelled?: boolean | null;
  invoice_no?: string | null;
  happycall_result?: string | null;
  happy_call_at?: unknown;
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
}): boolean {
  const status = (params.status ?? '').trim();
  if (status === '취소' || status === '해약') return false;
  return meetsInternalJoinCondition({
    invoice_no: params.invoice_no,
    happycall_result: params.happycall_result,
    happy_call_at: params.happy_call_at,
    is_cancelled: params.is_cancelled,
    product_type: params.product_type,
    item_name: params.item_name,
    source_snapshot_json: params.source_snapshot_json,
  });
}
