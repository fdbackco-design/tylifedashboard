/**
 * TY Life 계약 상세 HTML 파서.
 * node-html-parser 기반. 서버 전용.
 *
 * TODO: 실제 TY Life 상세 페이지 HTML 구조 확인 후 셀렉터 확정 필요.
 *       현재는 일반적인 form/table 구조를 가정한 초안.
 */

import { parse as parseHtml } from 'node-html-parser';
import type { TyLifeContractDetail } from '../types/sync';

/**
 * HTML에서 특정 label에 해당하는 값 추출.
 * 일반적인 th/td 쌍 또는 label+input 구조를 처리.
 */
function extractByLabel(root: ReturnType<typeof parseHtml>, label: string): string {
  // th 텍스트가 label과 일치하는 행의 td 값 추출
  const ths = root.querySelectorAll('th');
  for (const th of ths) {
    if (th.text.trim().includes(label)) {
      const td = th.closest('tr')?.querySelector('td');
      if (td) return td.text.trim();
    }
  }

  // dt/dd 구조
  const dts = root.querySelectorAll('dt');
  for (const dt of dts) {
    if (dt.text.trim().includes(label)) {
      const dd = dt.nextElementSibling;
      if (dd?.tagName === 'DD') return dd.text.trim();
    }
  }

  return '';
}

/**
 * TY Life 계약 상세 HTML을 파싱하여 TyLifeContractDetail 반환.
 *
 * ⚠️ SSN 원문(ssn_raw)은 반환 직후 normalize() 에서 즉시 masking 처리.
 *    절대 로그에 출력하거나 DB에 저장하지 말 것.
 */
export function parseContractDetailHtml(
  html: string,
  contractCode: string,
): TyLifeContractDetail {
  const root = parseHtml(html);

  // TODO: 아래 셀렉터/라벨명은 실제 HTML 구조 확인 후 수정 필요
  const raw: Record<string, string> = {
    customer_name: extractByLabel(root, '고객명'),
    ssn_raw: extractByLabel(root, '주민등록번호'),
    phone: extractByLabel(root, '전화번호'),
    rental_or_memo: extractByLabel(root, '렌탈신청번호'),
    join_date: extractByLabel(root, '가입일'),
    product_type: extractByLabel(root, '상품명'),
    item_name: extractByLabel(root, '물품명'),
    watch_fit: extractByLabel(root, '워치/핏'),
    unit_count: extractByLabel(root, '가입 구좌'),
    join_method: extractByLabel(root, '가입 방법'),
    status: extractByLabel(root, '계약 상태'),
    happy_call_at: extractByLabel(root, '해피콜 일시'),
    is_cancelled: extractByLabel(root, '취소 반품'),
    contractor_name: extractByLabel(root, '계약자'),
    beneficiary_name: extractByLabel(root, '지정인'),
    relationship: extractByLabel(root, '관계'),
    sales_member_name: extractByLabel(root, '담당 사원'),
    sales_member_id: extractByLabel(root, '사원 코드'),
    org_name: extractByLabel(root, '소속'),
    parent_org_name: extractByLabel(root, '상위 소속'),
  };

  // 렌탈신청번호/메모 판별
  const rentalOrMemo = raw['rental_or_memo'];
  const isNumeric = /^\d+$/.test(rentalOrMemo);

  return {
    contract_code: contractCode,
    customer_name: raw['customer_name'] || '',
    ssn_raw: raw['ssn_raw'] || '', // ⚠️ 즉시 masking 처리 필요
    phone: raw['phone'] || '',
    rental_request_no: isNumeric ? rentalOrMemo : null,
    memo: isNumeric ? null : rentalOrMemo || null,
    join_date: normalizeDate(raw['join_date']),
    product_type: raw['product_type'] || '일반',
    item_name:
      raw['item_name'] || '헬스365 고주파 발마사지기 [Health365]',
    watch_fit: raw['watch_fit'] || '해당없음',
    unit_count: parseInt(raw['unit_count'] || '1', 10),
    join_method: raw['join_method'] || '기타',
    status: raw['status'] || '준비',
    happy_call_at: raw['happy_call_at'] || null,
    is_cancelled:
      raw['is_cancelled'].includes('Y') ||
      raw['is_cancelled'].includes('취소') ||
      raw['is_cancelled'].includes('반품'),
    contractor_name: raw['contractor_name'] || null,
    beneficiary_name: raw['beneficiary_name'] || null,
    relationship_to_contractor: raw['relationship'] || null,
    sales_member_name: raw['sales_member_name'] || '',
    sales_member_external_id: raw['sales_member_id'] || '',
    org_name: raw['org_name'] || '',
    parent_org_name: raw['parent_org_name'] || null,
  };
}

/**
 * 다양한 날짜 형식을 'YYYY-MM-DD'로 정규화.
 * TODO: 실제 TY Life 날짜 형식 확인 후 수정
 */
function normalizeDate(raw: string): string {
  if (!raw) return '';

  // 이미 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // YYYY.MM.DD 또는 YYYY/MM/DD
  const dotSlash = raw.match(/^(\d{4})[./](\d{2})[./](\d{2})/);
  if (dotSlash) {
    return `${dotSlash[1]}-${dotSlash[2]}-${dotSlash[3]}`;
  }

  // YYYYMMDD
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }

  return raw;
}
