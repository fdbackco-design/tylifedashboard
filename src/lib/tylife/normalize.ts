/**
 * TY Life 원본 데이터 → 도메인 모델 변환.
 *
 * - normalizeCustomerFromList  : 리스트 파싱 결과 → CustomerInsert
 * - normalizeContractFromList  : 리스트 파싱 결과 → ContractInsert (부분)
 * - mergeDetailIntoContract    : 상세 파싱으로 ContractInsert 보강
 * - normalizeSalesMember       : 담당자 → OrganizationMemberInsert
 *
 * SSN 원문(ssn_raw)은 normalizeCustomerFromDetail 에서만 처리.
 */

import type { ParsedListItem, TyLifeContractDetail } from '../types/sync';
import type { CustomerInsert } from '../types/customer';
import type {
  ContractInsert,
  ContractStatus,
  ProductType,
  WatchFitType,
  JoinMethodType,
} from '../types/contract';
import type { OrganizationMemberInsert, RankType } from '../types/organization';
import { parseSsn, parseMaskedSsn, parseRentalOrMemo } from '../utils/mask';
import { normalizeDate } from './html-parser';
import { normalizeInvoiceNo } from '../utils/invoice-no';

export const DEFAULT_ITEM_NAME_PLACEHOLDER = '헬스365 고주파 발마사지기 [Health365]';

// ─────────────────────────────────────────────
// 열거형 정규화 헬퍼
// ─────────────────────────────────────────────

export function normalizeStatus(raw: string): ContractStatus {
  const map: Record<string, ContractStatus> = {
    준비: '준비',
    대기: '대기',
    상담중: '상담중',
    가입: '가입',
    해피콜완료: '해피콜완료',
    '해피콜 완료': '해피콜완료',
    배송준비: '배송준비',
    '배송 준비': '배송준비',
    배송완료: '배송완료',
    '배송 완료': '배송완료',
    정산완료: '정산완료',
    '정산 완료': '정산완료',
    취소: '취소',
    해약: '해약',
  };
  return map[raw.trim()] ?? '준비';
}

export function normalizeProductType(raw: string): ProductType {
  const text = raw.trim();
  if (text.includes('갤럭시케어 라이트')) return '갤럭시케어 라이트';
  if (text.includes('TY갤럭시케어_무') || text.endsWith('_무')) return '무';
  if (text.includes('TY갤럭시케어')) return 'TY갤럭시케어';
  if (text.includes('올라이프케어')) return '올라이프케어';
  if (text.includes('스페셜라이프케어')) return '스페셜라이프케어';
  if (text === '무') return '무';
  // 레거시: '갤럭시케어' 단독 표기
  if (text.includes('갤럭시케어')) return 'TY갤럭시케어';

  // 그 외: 원본 상품명을 그대로 보존 (빈 값이면 '일반')
  return (text || '일반') as ProductType;
}

export function normalizeWatchFit(raw: string): WatchFitType {
  if (raw.includes('워치')) return '갤럭시워치';
  if (raw.includes('핏')) return '갤럭시핏';
  return '해당없음';
}

export function normalizeJoinMethod(raw: string): JoinMethodType {
  if (raw.includes('해피콜')) return '해피콜';
  if (raw.includes('간편')) return '간편가입';
  return '기타';
}

// ─────────────────────────────────────────────
// 고객 정규화
// ─────────────────────────────────────────────

/**
 * 리스트 HTML 파싱 결과에서 CustomerInsert 생성.
 * ssn_masked("YYMMDD-G******")에서 birth_date / gender 파생.
 * 파싱 실패 시 null 반환 (호출자가 처리).
 */
export function normalizeCustomerFromList(item: ParsedListItem): CustomerInsert | null {
  if (!item.ssn_masked) return null;

  try {
    const parsed = parseMaskedSsn(item.ssn_masked);
    return {
      name: item.customer_name,
      birth_date: parsed.birth_date,
      gender: parsed.gender,
      ssn_masked: parsed.ssn_masked,
      phone: item.phone ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * 상세 HTML 파싱 결과로 고객 정보 보강.
 * ssn_raw 가 있을 경우 masking 처리 후 즉시 폐기.
 * TODO: 상세 페이지에 SSN이 노출되는 경우 이 함수 사용
 */
export function normalizeCustomerFromDetail(detail: TyLifeContractDetail): Partial<CustomerInsert> | null {
  if (!detail.ssn_raw) return null;

  try {
    const parsed = parseSsn(detail.ssn_raw);
    // ssn_raw 는 여기서 소비됨 — 반환 객체에 포함하지 않음
    return {
      birth_date: parsed.birth_date,
      gender: parsed.gender,
      ssn_masked: parsed.ssn_masked,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// 계약 정규화
// ─────────────────────────────────────────────

/**
 * 리스트 파싱 결과 → ContractInsert.
 * unit_count 는 이 단계에서 확정 불가 → 1 (placeholder).
 * 상세 fetch 후 mergeDetailIntoContract() 로 보강 필요.
 */
/**
 * 해피콜 일시 raw 문자열에서 (날짜, 꼬리 결과 텍스트) 분리.
 *
 * TY 외부 데이터에서 한 셀에 "2026-05-11 성공" 처럼 날짜와 결과가 같이 들어오는 케이스가 있다.
 * 이 값을 contracts.happy_call_at (timestamptz) 으로 그대로 저장하면 invalid input syntax 오류가
 * 발생하므로, 날짜와 꼬리를 분리해 happy_call_at / happycall_result 두 컬럼에 각각 정규화한다.
 *
 * - 입력에 꼬리가 없으면 tail은 빈 문자열.
 * - 날짜만으로 인식 불가하면 ymd도 빈 문자열.
 */
function splitHappycallAtAndResult(raw: string | null | undefined): { ymd: string; tail: string } {
  const s = (raw ?? '').trim();
  if (!s) return { ymd: '', tail: '' };
  // "YYYY-MM-DD <tail>" / "YYYY.MM.DD <tail>" / "YYYY/MM/DD <tail>" / "YYYYMMDD <tail>"
  const m = s.match(/^(\d{4}(?:[-./]\d{2}[-./]\d{2}|\d{4}))(?:\s+(.+))?$/);
  if (m) {
    return { ymd: normalizeDate(m[1]), tail: (m[2] ?? '').trim() };
  }
  // 위 매치 실패 시에도 normalizeDate가 안전하게 앞부분 날짜만 추출하도록 위임
  return { ymd: normalizeDate(s), tail: '' };
}

export function normalizeContractFromList(
  item: ParsedListItem,
  customerId: string,
  salesMemberId: string | null,
): ContractInsert {
  const { rental_request_no, memo } = parseRentalOrMemo(item.rental_or_memo);

  // 해피콜 일시·결과는 한 셀에 같이 들어오는 케이스("2026-05-11 성공")가 있어 분리한다.
  // happycall_result 셀에 값이 따로 있으면 그 값이 우선이고, 없으면 raw 꼬리에서 추출한다.
  const happycallSplit = splitHappycallAtAndResult(item.happycall_at_raw);
  const happycallResultFromSheet = (item.happycall_result ?? '').trim();
  const happycallResultFinal = happycallResultFromSheet !== ''
    ? happycallResultFromSheet
    : (happycallSplit.tail || null);

  return {
    contract_code: item.contract_code,
    sequence_no: item.sequence_no_raw ? (parseInt(item.sequence_no_raw, 10) || null) : null,
    rental_request_no,
    invoice_no: normalizeInvoiceNo(item.invoice_no),
    memo,
    customer_id: customerId,
    sales_member_id: salesMemberId,
    join_date: normalizeDate(item.joined_at_raw ?? ''),
    product_type: normalizeProductType(item.product_type_raw ?? ''),
    // 상세에서 업데이트 — DB 스키마 item_name NOT NULL 기본값과 동일한 placeholder
    // (상세에서만 실제 물품명이 오므로, 정상 케이스에서는 상세 fetch 후 overwrite 되어야 함)
    item_name: DEFAULT_ITEM_NAME_PLACEHOLDER,
    watch_fit: normalizeWatchFit(item.watch_fit_raw ?? ''),
    unit_count: 1,
    join_method: normalizeJoinMethod(item.join_method_raw ?? ''),
    status: normalizeStatus(item.status_raw ?? ''),
    happy_call_at: happycallSplit.ymd || null,
    is_cancelled: item.is_cancelled,
    external_id: item.external_id,
    affiliation_name: item.affiliation_name,
    happycall_result: happycallResultFinal,
    contractor_name: null,
    beneficiary_name: null,
    relationship_to_contractor: null,
  };
}

/**
 * 상세 파싱 결과로 ContractInsert 보강.
 * unit_count, item_name, 계약자 관계 등 상세에서만 얻을 수 있는 값 병합.
 */
export function mergeDetailIntoContract(
  base: ContractInsert,
  detail: TyLifeContractDetail,
): ContractInsert {
  return {
    ...base,
    invoice_no: normalizeInvoiceNo(detail.invoice_no ?? base.invoice_no),
    rental_request_no: detail.rental_request_no ?? base.rental_request_no,
    item_name: detail.item_name ?? base.item_name,
    unit_count: (detail.unit_count != null && detail.unit_count > 0)
      ? detail.unit_count
      : base.unit_count,
    join_method: detail.join_method ? normalizeJoinMethod(detail.join_method) : base.join_method,
    watch_fit: detail.watch_fit ? normalizeWatchFit(detail.watch_fit) : base.watch_fit,
    happy_call_at: detail.happy_call_at ? normalizeDate(detail.happy_call_at) : base.happy_call_at,
    contractor_name: detail.contractor_name ?? base.contractor_name,
    beneficiary_name: detail.beneficiary_name ?? base.beneficiary_name,
    relationship_to_contractor:
      detail.relationship_to_contractor ?? base.relationship_to_contractor,
  };
}

// ─────────────────────────────────────────────
// 조직원 정규화
// ─────────────────────────────────────────────

export interface SalesMemberSource {
  sales_member_name: string;
  sales_member_external_id: string | null;
  org_rank?: string | null;
  /**
   * 영업자 전화번호 hint. TY 리스트에는 영업자 phone 이 직접 들어오지 않지만,
   * "자기 가입(customer == sales_member)" 케이스에서 호출 지점이 customer phone 을 전달하면
   * upsertSalesMember 의 중복 노드 방지(phone digits 매칭) lookup 에 사용된다.
   * null/undefined 면 set 하지 않는다 (기존 phone 을 덮어쓰지 않도록).
   */
  phone?: string | null;
}

/**
 * 담당 사원 정보 → OrganizationMemberInsert.
 * external_id 가 있어야 upsert 중복 방지 가능.
 */
export function normalizeSalesMember(
  item: SalesMemberSource,
): OrganizationMemberInsert {
  const out: OrganizationMemberInsert = {
    name: item.sales_member_name,
    rank: inferRank(item.org_rank ?? ''),
    external_id: item.sales_member_external_id || null,
    is_active: true,
  };
  if (item.phone != null && String(item.phone).trim() !== '') {
    out.phone = item.phone;
  }
  return out;
}

/** 소속명 / 직책 문자열에서 직급 추론 */
export function inferRank(raw: string): RankType {
  if (!raw) return '영업사원';
  if (raw.includes('본사')) return '본사';
  if (raw.includes('사업본부장') || raw.includes('본부장')) return '사업본부장';
  if (raw.includes('센터장')) return '센터장';
  if (raw.includes('리더')) return '리더';
  return '영업사원';
}
