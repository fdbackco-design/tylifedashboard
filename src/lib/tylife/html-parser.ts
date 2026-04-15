/**
 * TY Life HTML 파서 — cheerio 기반. 서버 전용.
 *
 * parseContractListHtml  : data.listHtml → ParsedListItem[]
 * parseContractDetailHtml: GET /contract/{id} HTML → TyLifeContractDetail
 * smokeTestListParser    : 예제 HTML로 파서 동작 검증
 */

import * as cheerio from 'cheerio';
import type { ParsedListItem, TyLifeContractDetail } from '../types/sync';

// ─────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────

/** 공백 정리, "-" → null */
function clean(value: string): string | null {
  const t = value.trim().replace(/\s+/g, ' ');
  return t === '' || t === '-' ? null : t;
}

/**
 * 날짜 문자열 → 'YYYY-MM-DD'.
 * 지원 형식: YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD
 */
export function normalizeDate(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ds = s.match(/^(\d{4})[./](\d{2})[./](\d{2})/);
  if (ds) return `${ds[1]}-${ds[2]}-${ds[3]}`;
  const cs = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (cs) return `${cs[1]}-${cs[2]}-${cs[3]}`;
  return s;
}

// ─────────────────────────────────────────────
// 리스트 HTML 파서
// ─────────────────────────────────────────────

/**
 * data.listHtml 문자열 파싱 → ParsedListItem[].
 *
 * 예상 구조:
 *   .product-list-wrap
 *     .product-list[onclick="goDetail(N)"]
 *       .list-cell
 *         .list-tit  ← 키
 *         .list-cont ← 값 (계약코드는 내부 <a> 텍스트)
 *
 * TODO: 실제 응답 HTML 확인 후 셀렉터 보정 필요
 */
export function parseContractListHtml(listHtml: string): ParsedListItem[] {
  const $ = cheerio.load(listHtml);
  const items: ParsedListItem[] = [];

  $('.product-list').each((_idx, rowEl) => {
    const row = $(rowEl);

    // goDetail(N) 에서 external_id 추출
    const onclick = row.attr('onclick') ?? '';
    const detailMatch = onclick.match(/goDetail\((\d+)\)/);
    const external_id = detailMatch ? detailMatch[1] : null;

    // .list-cell 단위 키/값 맵 구성 + 원본 스냅샷
    const cellMap: Record<string, string> = {};
    const snapshot: Record<string, string | null> = {};

    row.find('.list-cell').each((_i, cellEl) => {
      const cell = $(cellEl);
      const key = cell.find('.list-tit').text().trim();
      if (!key) return;

      const contEl = cell.find('.list-cont');
      // 계약 코드처럼 <a> 안에 있는 경우 우선
      const aText = contEl.find('a').first().text().trim();
      const rawText = contEl.text().trim();
      const value = aText || rawText;

      cellMap[key] = value;
      snapshot[key] = clean(value);
    });

    // 여러 키 이름 변형을 허용하는 getter
    const get = (...keys: string[]): string | null => {
      for (const k of keys) {
        const v = clean(cellMap[k] ?? '');
        if (v !== null) return v;
      }
      return null;
    };

    const contract_code = get('계약 코드', '계약코드');
    if (!contract_code) return; // 헤더·빈 행 스킵

    // 취소/반품: 값이 있고 'N' / '아니오' / '해당없음' 이 아니면 true
    const cancelRaw = get('취소/반품', '취소반품', '취소 반품');
    const is_cancelled =
      cancelRaw !== null &&
      !['n', '아니오', '해당없음', 'false'].includes(cancelRaw.toLowerCase());

    items.push({
      sequence_no_raw: get('순번'),
      rental_or_memo: get('렌탈신청번호'),
      invoice_no: get('송장번호', '운송장번호', '운송장 번호'),
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
      // 원본 스냅샷을 ParsedListItem에 함께 전달
      _snapshot: snapshot,
    });
  });

  return items;
}

// ─────────────────────────────────────────────
// 상세 HTML 파서
// ─────────────────────────────────────────────

/**
 * th/td·dt/dd 구조에서 label 매칭 값 추출.
 * TODO: 실제 HTML 구조 확인 후 셀렉터 확정 필요
 */
function extractByLabel(
  $: cheerio.CheerioAPI,
  ...labels: string[]
): string | null {
  for (const label of labels) {
    // th → 같은 tr 의 td
    let found: string | null = null;
    $('th').each((_i, el) => {
      if (found) return false; // break
      if ($(el).text().trim().includes(label)) {
        const td = $(el).closest('tr').find('td').first();
        found = clean(td.text());
      }
    });
    if (found) return found;

    // dt → 다음 dd
    $('dt').each((_i, el) => {
      if (found) return false;
      if ($(el).text().trim().includes(label)) {
        const dd = $(el).next('dd');
        found = clean(dd.text());
      }
    });
    if (found) return found;
  }
  return null;
}

/**
 * 상세 HTML → TyLifeContractDetail.
 * 리스트에 없는 필드(물품명, 구좌수, 계약자 관계 등) 보강용.
 * TODO: 실제 상세 페이지 HTML 구조 확인 후 라벨 확정 필요
 */
export function parseContractDetailHtml(
  html: string,
  contractCode: string,
): TyLifeContractDetail {
  const $ = cheerio.load(html);

  const unitRaw = extractByLabel($, '가입 구좌', '구좌');
  const unitCount = unitRaw ? parseInt(unitRaw.replace(/[^\d]/g, ''), 10) : null;

  return {
    contract_code: contractCode,
    item_name: extractByLabel($, '물품명', '품목명'),
    invoice_no: extractByLabel($, '송장 번호', '송장번호', '운송장 번호', '운송장번호'),
    rental_request_no: extractByLabel($, '렌탈신청번호', '렌탈 신청 번호'),
    unit_count:
      unitCount !== null && Number.isFinite(unitCount) && unitCount > 0
        ? unitCount
        : null,
    join_method: extractByLabel($, '가입 방법', '가입방법'),
    watch_fit: extractByLabel($, '워치/핏', '워치핏'),
    happy_call_at: extractByLabel($, '해피콜 일시', '해피콜일시'),
    relationship_to_contractor: extractByLabel($, '계약자와의 관계', '관계'),
    contractor_name: extractByLabel($, '계약자'),
    beneficiary_name: extractByLabel($, '지정인', '수혜자'),
    sales_member_external_id: extractByLabel($, '사원 코드', '사원코드', '담당자 코드'),
    parent_org_name: extractByLabel($, '상위 소속', '상위소속', '레그'),
    // TODO: 상세 페이지에 SSN 원문이 노출되는 경우 추출 후 즉시 masking 처리
    ssn_raw: null,
  };
}

// ─────────────────────────────────────────────
// Smoke test (개발·디버깅용)
// ─────────────────────────────────────────────

/**
 * 예제 listHtml로 파서 동작 확인.
 * 실제 API 응답을 받은 후 샘플을 이 함수에 넣어 매핑을 검증하세요.
 *
 * 사용 예:
 *   import { smokeTestListParser } from '@/lib/tylife/html-parser';
 *   console.log(JSON.stringify(smokeTestListParser(), null, 2));
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
      <div class="product-list" onclick="goDetail(132677)">
        <div class="list-cell"><div class="list-tit">순번</div><div class="list-cont">2</div></div>
        <div class="list-cell"><div class="list-tit">렌탈신청번호</div><div class="list-cont">특이사항 있음</div></div>
        <div class="list-cell"><div class="list-tit">고객명</div><div class="list-cont">이영희</div></div>
        <div class="list-cell"><div class="list-tit">주민번호</div><div class="list-cont">850512-2******</div></div>
        <div class="list-cell"><div class="list-tit">계약 코드</div><div class="list-cont"><a>TY-2024-00002</a></div></div>
        <div class="list-cell"><div class="list-tit">소속</div><div class="list-cont">-</div></div>
        <div class="list-cell"><div class="list-tit">담당자</div><div class="list-cont">박민수</div></div>
        <div class="list-cell"><div class="list-tit">상품명</div><div class="list-cont">일반</div></div>
        <div class="list-cell"><div class="list-tit">연락처</div><div class="list-cont">01098765432</div></div>
        <div class="list-cell"><div class="list-tit">가입 상태</div><div class="list-cont">가입</div></div>
        <div class="list-cell"><div class="list-tit">가입일</div><div class="list-cont">2024.04.01</div></div>
        <div class="list-cell"><div class="list-tit">취소/반품</div><div class="list-cont">Y</div></div>
        <div class="list-cell"><div class="list-tit">해피콜 일시</div><div class="list-cont">-</div></div>
        <div class="list-cell"><div class="list-tit">해피콜 결과</div><div class="list-cont">-</div></div>
        <div class="list-cell"><div class="list-tit">가입 방법</div><div class="list-cont">간편가입</div></div>
        <div class="list-cell"><div class="list-tit">워치/핏</div><div class="list-cont">해당없음</div></div>
      </div>
    </div>
  `;
  return parseContractListHtml(sampleHtml);
}
