/**
 * TY Life 원본 데이터 → 도메인 모델 변환.
 * SSN 원문은 이 모듈에서 masking 처리 후 폐기.
 */

import type { TyLifeContractDetail } from '../types/sync';
import type { CustomerInsert } from '../types/customer';
import type { ContractInsert, ContractStatus, ProductType, WatchFitType, JoinMethodType } from '../types/contract';
import type { OrganizationMemberInsert } from '../types/organization';
import type { RankType } from '../types/organization';
import { parseSsn, parseRentalOrMemo } from '../utils/mask';

// ─────────────────────────────────────────────
// 고객 정규화
// ─────────────────────────────────────────────

/**
 * 상세 HTML 파싱 결과에서 CustomerInsert 생성.
 * SSN 원문(ssn_raw)은 이 함수에서 masking 후 즉시 사용 불가.
 */
export function normalizeCustomer(detail: TyLifeContractDetail): CustomerInsert {
  const parsed = parseSsn(detail.ssn_raw);
  // ssn_raw는 여기서 소비됨 — 이후 참조 금지

  return {
    name: detail.customer_name,
    birth_date: parsed.birth_date,
    gender: parsed.gender,
    ssn_masked: parsed.ssn_masked,
    phone: detail.phone,
  };
}

// ─────────────────────────────────────────────
// 계약 정규화
// ─────────────────────────────────────────────

/** TY Life 상태 문자열 → ContractStatus */
function normalizeStatus(raw: string): ContractStatus {
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

/** TY Life 상품명 → ProductType */
function normalizeProductType(raw: string): ProductType {
  if (raw.includes('갤럭시케어') || raw.includes('TY')) return 'TY갤럭시케어';
  if (raw === '무') return '무';
  return '일반';
}

/** TY Life 워치/핏 → WatchFitType */
function normalizeWatchFit(raw: string): WatchFitType {
  if (raw.includes('워치')) return '갤럭시워치';
  if (raw.includes('핏')) return '갤럭시핏';
  return '해당없음';
}

/** TY Life 가입방법 → JoinMethodType */
function normalizeJoinMethod(raw: string): JoinMethodType {
  if (raw.includes('해피콜')) return '해피콜';
  if (raw.includes('간편')) return '간편가입';
  return '기타';
}

/**
 * 상세 HTML 파싱 결과에서 ContractInsert 생성.
 * customer_id는 DB upsert 후 할당 → 빈 문자열로 초기화 후 교체.
 */
export function normalizeContract(
  detail: TyLifeContractDetail,
  customerId: string,
  salesMemberId: string | null,
): ContractInsert {
  const { rental_request_no, memo } = parseRentalOrMemo(
    detail.rental_request_no ?? detail.memo ?? null,
  );

  return {
    contract_code: detail.contract_code,
    rental_request_no,
    memo,
    customer_id: customerId,
    sales_member_id: salesMemberId,
    join_date: detail.join_date,
    product_type: normalizeProductType(detail.product_type),
    item_name: detail.item_name,
    watch_fit: normalizeWatchFit(detail.watch_fit),
    unit_count: detail.unit_count,
    join_method: normalizeJoinMethod(detail.join_method),
    status: normalizeStatus(detail.status),
    happy_call_at: detail.happy_call_at,
    is_cancelled: detail.is_cancelled,
    contractor_name: detail.contractor_name,
    beneficiary_name: detail.beneficiary_name,
    relationship_to_contractor: detail.relationship_to_contractor,
    external_id: detail.contract_code, // contract_code를 external_id로 사용
  };
}

// ─────────────────────────────────────────────
// 조직원 정규화
// ─────────────────────────────────────────────

/** normalizeSalesMember가 실제로 필요로 하는 최소 필드 */
export interface SalesMemberSource {
  sales_member_name: string;
  sales_member_external_id: string;
  /** 직급 추론용 — org_name 또는 rank 문자열 */
  org_rank?: string;
}

/**
 * 담당 사원 정보로 OrganizationMemberInsert 생성.
 * TyLifeContractDetail에서 추출한 값을 직접 전달.
 */
export function normalizeSalesMember(
  item: SalesMemberSource,
): OrganizationMemberInsert {
  return {
    name: item.sales_member_name,
    rank: inferRank(item.org_rank ?? ''),
    external_id: item.sales_member_external_id || null,
    is_active: true,
  };
}

/** 소속명/직책 문자열에서 직급 추론 */
export function inferRank(raw: string): RankType {
  if (!raw) return '영업사원';
  if (raw.includes('본사')) return '본사';
  if (raw.includes('사업본부장') || raw.includes('본부장')) return '사업본부장';
  if (raw.includes('센터장')) return '센터장';
  if (raw.includes('리더')) return '리더';
  return '영업사원';
}
