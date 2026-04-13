/**
 * TY Life HTML 파서.
 * node-html-parser 기반. 서버 전용.
 *
 * 1) parseContractListHtml  — POST /contract/list 응답의 data.listHtml 파싱
 * 2) parseContractDetailHtml — GET /contract/{id} 상세 HTML 파싱
 */

import { parse as parseHtml } from 'node-html-parser';
import type { ParsedListItem, TyLifeContractDetail } from '../types/sync';

// ─────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────

/** 빈 문자열과 "-" 를 null 로 정규화 */
function clean(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' || trimmed === '-' ? null : trimmed;
}

/**
 * 다양한 날짜 형식 → 'YYYY-MM-DD'.
 * - YYYY-MM-DD (그대로)
 * - YYYY.MM.DD / YYYY/MM/DD
 * - YYYYMMDD
 */
export function normalizeDate(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dotSlash = s.match(/^(\d{4})[./](\d{2})[./](\d{2})/);
  if (dotSlash) return `${dotSlash[1]}-${dotSlash[2]}-${dotSlash[3]}`;

  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

  return s;
}

// ─────────────────────────────────────────────
// 1) 리스트 HTML 파서
// ─────────────────────────────────────────────

/**
 * data.listHtml 문자열을 받아 계약 행 배열 반환.
 *
 * 예상 구조:
 * <div class="product-list-wrap">
 *   <div class="product-list" onclick="goDetail(132676)">
 *     <div class="list-cell">
 *       <div class="list-tit">순번</div>
 *       <div class="list-cont">1</div>
 *     </div>
 *     ...
 *   </div>
 * </div>
 *
 * TODO: 실제 HTML 구조 확인 후 셀렉터 조정 필요
 */
export function parseContractListHtml(listHtml: string): ParsedListItem[] {
  const root = parseHtml(listHtml);
  const rows = root.querySelectorAll('.product-list');

  const items: ParsedListItem[] = [];

  for (const row of rows) {
    // goDetail(N) 에서 external_id 추출
    const onclickAttr = row.getAttribute('onclick') ?? '';
    const detailMatch = onclickAttr.match(/goDetail\((\d+)\)/);
    const external_id = detailMatch ? detailMatch[1] : null;

    // .list-cell 단위로 키/값 추출
    const cellMap: Record<string, string> = {};
    for (const cell of row.querySelectorAll('.list-cell')) {
      const key = clean(cell.querySelector('.list-tit')?.text ?? '') ?? '';
      const contEl = cell.querySelector('.list-cont');

      // 계약 코드처럼 <a> 태그에 들어있는 경우 우선
      const aText = clean(contEl?.querySelector('a')?.text ?? '');
      const rawText = clean(contEl?.text ?? '');
      const value = aText ?? rawText ?? '';

      if (key) cellMap[key] = value;
    }

    // 셀 키 매핑 헬퍼 (키 이름 변형 대응)
    const get = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = cellMap[k];
        if (v !== undefined && v !== '') return v;
      }
      return null;
    };

    // 취소/반품 파싱
    const cancelRaw = get('취소/반품', '취소반품', '취소 반품');
    const is_cancelled =
      cancelRaw !== null &&
      cancelRaw !== 'N' &&
      cancelRaw !== '아니오' &&
      cancelRaw !== '해당없음';

    const contract_code = get('계약 코드', '계약코드') ?? '';

    // 계약 코드 없는 행(헤더·빈 행 등) 스킵
    if (!contract_code) continue;

    items.push({
      sequence_no_raw: get('순번'),
      rental_or_memo: get('렌탈신청번호'),
      customer_name: get('고객명') ?? '',
      ssn_masked: get('주민번호', '주민등록번호') ?? '',
      contract_code,
      affiliation_name: get('소속'),
      sales_member_name: get('담당자', '담당 사원'),
      product_type_raw: get('상품명'),
      phone: get('연락처'),
      status_raw: get('가입 상태', '가입상태'),
      joined_at_raw: get('가입일'),
      is_cancelled,
      happycall_at_raw: get('해피콜 일시', '해피콜일시'),
      happycall_result: get('해피콜 결과', '해피콜결과'),
      join_method_raw: get('가입 방법', '가입방법'),
      watch_fit_raw: get('워치/핏', '워치핏'),
      external_id,
    });
  }

  return items;
}

// ─────────────────────────────────────────────
// 2) 상세 HTML 파서
// ─────────────────────────────────────────────

/**
 * th/td 구조에서 label에 해당하는 값 추출.
 * TODO: 실제 HTML 구조 확인 후 셀렉터 보완 필요
 */
function extractByLabel(
  root: ReturnType<typeof parseHtml>,
  ...labels: string[]
): string | null {
  for (const label of labels) {
    // th → 같은 tr의 td
    const ths = root.querySelectorAll('th');
    for (const th of ths) {
      if (th.text.trim().includes(label)) {
        const td = th.closest('tr')?.querySelector('td');
        if (td) return clean(td.text);
      }
    }

    // dt → 다음 형제 dd
    const dts = root.querySelectorAll('dt');
    for (const dt of dts) {
      if (dt.text.trim().includes(label)) {
        const dd = dt.nextElementSibling;
        if (dd?.tagName === 'DD') return clean(dd.text);
      }
    }

    // label 태그
    const lbls = root.querySelectorAll('label');
    for (const lbl of lbls) {
      if (lbl.text.trim().includes(label)) {
        const input = lbl.nextElementSibling;
        if (input) return clean(input.getAttribute('value') ?? input.text);
      }
    }
  }

  return null;
}

/**
 * TY Life 계약 상세 HTML → TyLifeContractDetail.
 *
 * contractCode: 리스트에서 가져온 계약 코드 (상세 HTML에 없을 수도 있음)
 *
 * TODO: 실제 상세 페이지 HTML 구조 확인 후 각 라벨/셀렉터 확정 필요
 * TODO: SSN 노출 여부 확인 — 노출된다면 ssn_raw 파싱 후 즉시 masking 처리
 */
export function parseContractDetailHtml(
  html: string,
  contractCode: string,
): TyLifeContractDetail {
  const root = parseHtml(html);

  const unitCountRaw = extractByLabel(root, '가입 구좌', '구좌');
  const unitCount = unitCountRaw ? parseInt(unitCountRaw.replace(/[^\d]/g, ''), 10) : null;

  return {
    contract_code: contractCode,
    item_name: extractByLabel(root, '물품명', '품목명'),
    unit_count: Number.isFinite(unitCount) && unitCount !== null && unitCount > 0
      ? unitCount
      : null,
    relationship_to_contractor: extractByLabel(root, '계약자와의 관계', '관계'),
    contractor_name: extractByLabel(root, '계약자'),
    beneficiary_name: extractByLabel(root, '지정인', '수혜자'),
    sales_member_external_id: extractByLabel(root, '사원 코드', '사원코드', '담당자 코드'),
    parent_org_name: extractByLabel(root, '상위 소속', '상위소속', '레그'),
    // TODO: 상세 페이지에 SSN 원문이 있으면 추출 후 즉시 masking 처리 필요
    ssn_raw: null,
  };
}

// ─────────────────────────────────────────────
// 파서 smoke test (개발/디버깅용)
// ─────────────────────────────────────────────

/**
 * 예제 HTML로 파서 동작 검증.
 * 실제 API 응답을 받은 후 이 함수에 샘플을 넣어 매핑을 확인하세요.
 *
 * 사용 예:
 *   import { smokeTestListParser } from '@/lib/tylife/html-parser';
 *   console.log(smokeTestListParser());
 */
export function smokeTestListParser(): ParsedListItem[] {
  const sampleHtml = `
    <div class="product-list-wrap">
      <div class="product-list" onclick="goDetail(132676)">
        <div class="list-cell"><div class="list-tit">순번</div><div class="list-cont">1</div></div>
        <div class="list-cell"><div class="list-tit">렌탈신청번호</div><div class="list-cont">12345678</div></div>
        <div class="list-cell"><div class="list-tit">고객명</div><div class="list-cont">홍길동</div></div>
        <div class="list-cell"><div class="list-tit">주민번호</div><div class="list-cont">901201-1******</div></div>
        <div class="list-cell"><div class="list-tit">계약 코드</div><div class="list-cont"><a>TY-2024-00001</a></div></div>
        <div class="list-cell"><div class="list-tit">소속</div><div class="list-cont">서울센터</div></div>
        <div class="list-cell"><div class="list-tit">담당자</div><div class="list-cont">김철수</div></div>
        <div class="list-cell"><div class="list-tit">상품명</div><div class="list-cont">TY갤럭시케어</div></div>
        <div class="list-cell"><div class="list-tit">연락처</div><div class="list-cont">01012345678</div></div>
        <div class="list-cell"><div class="list-tit">가입 상태</div><div class="list-cont">해피콜완료</div></div>
        <div class="list-cell"><div class="list-tit">가입일</div><div class="list-cont">2024-03-15</div></div>
        <div class="list-cell"><div class="list-tit">취소/반품</div><div class="list-cont">N</div></div>
        <div class="list-cell"><div class="list-tit">해피콜 일시</div><div class="list-cont">2024-03-16 10:30</div></div>
        <div class="list-cell"><div class="list-tit">해피콜 결과</div><div class="list-cont">가입</div></div>
        <div class="list-cell"><div class="list-tit">가입 방법</div><div class="list-cont">해피콜</div></div>
        <div class="list-cell"><div class="list-tit">워치/핏</div><div class="list-cont">갤럭시워치</div></div>
      </div>
    </div>
  `;

  return parseContractListHtml(sampleHtml);
}
