/**
 * 사전 발급 계정과 TY 동기화 사람 데이터를 매칭할 때 쓰는 정규화 헬퍼.
 * - 이름: 앞뒤·중간 공백 정리 + 영문 소문자 + 양쪽 끝의 비문자(괄호·기호) 제거.
 *   "[고객] 박혜민" 형태의 접두는 데이터 측에서 자주 나타나므로 함께 제거한다.
 * - 전화번호: 숫자만 남긴다. (하이픈/공백/괄호 제거)
 */

export function normalizeName(value: unknown): string {
  if (value == null) return '';
  let s = String(value);
  // 자주 보이는 접두 표기 제거
  s = s.replace(/^\[고객\]\s*/u, '');
  // 모든 공백류 → 단일 공백, 양 끝 trim
  s = s.replace(/[\s\u00A0]+/g, ' ').trim();
  // 영문 소문자
  s = s.toLowerCase();
  // 양 끝의 비문자(괄호·따옴표·점 등) 제거
  s = s.replace(/^[^0-9a-z가-힣]+|[^0-9a-z가-힣]+$/gu, '');
  return s;
}

export function normalizePhone(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/\D/g, '');
}

/**
 * 사전 발급 계정의 입력값과 TY 사람 데이터(name/phone)가
 * "이름은 같다고 볼 수 있는가" 를 판정한다.
 * - 빈 문자열끼리는 false (의도적으로 매칭 안 함)
 */
export function isSameNormalizedName(a: unknown, b: unknown): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb;
}

export function isSameNormalizedPhone(a: unknown, b: unknown): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb;
}
