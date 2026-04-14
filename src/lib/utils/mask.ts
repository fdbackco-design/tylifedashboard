import type { ParsedSsn } from '../types/customer';

/**
 * 마스킹된 주민번호("YYMMDD-G******")에서 birth_date / gender 파생.
 * 리스트 HTML에서 이미 마스킹된 형태로 노출될 때 사용.
 * 원문이 없어도 앞 7자리(성별 자리 포함)에서 파생 가능.
 *
 * @param masked - "901201-1******" 형식
 */
/**
 * 마스킹된 주민번호에서 birth_date / gender / ssn_masked 파생.
 *
 * 지원 형식:
 *   - "820605 - xxxxxxx"  (TY Life 리스트 — 성별 자리 마스킹)
 *   - "820605-1******"    (내부 정규화 형식 — 성별 자리 노출)
 *   - "8206051******"     (하이픈 없는 형식)
 *
 * 성별 자리가 마스킹("x")된 경우:
 *   - 출생 연도(YY)로 세기 추정 (00~26 → 20xx, 27~99 → 19xx)
 *   - gender 는 'M' 으로 placeholder (상세 페이지에서 보강 필요)
 */
export function parseMaskedSsn(masked: string): ParsedSsn {
  // 공백 제거 후 앞 6자리(YYMMDD) 추출
  const noSpace = masked.replace(/\s/g, '');
  const digitsMatch = noSpace.match(/^(\d{2})(\d{2})(\d{2})/);

  if (!digitsMatch) {
    throw new Error(`parseMaskedSsn: YYMMDD 추출 실패 — "${masked}"`);
  }

  const [, yy, mm, dd] = digitsMatch;

  // 하이픈 또는 공백 다음 첫 문자 = 성별 자리
  const afterDash = noSpace.slice(6).replace(/^-/, '');
  const genderChar = afterDash[0] ?? 'x';
  const genderNum = parseInt(genderChar, 10);

  let gender: 'M' | 'F';
  let century: string;

  if (!Number.isNaN(genderNum)) {
    // 성별 자리가 숫자로 노출된 경우
    if (genderNum === 9 || genderNum === 0) {
      century = '18'; gender = genderNum === 9 ? 'M' : 'F';
    } else if (genderNum === 1 || genderNum === 2) {
      century = '19'; gender = genderNum === 1 ? 'M' : 'F';
    } else if (genderNum === 3 || genderNum === 4) {
      century = '20'; gender = genderNum === 3 ? 'M' : 'F';
    } else {
      throw new Error(`parseMaskedSsn: 성별 자리 오류 — "${genderChar}"`);
    }
  } else {
    // 성별 자리가 'x' 등으로 마스킹된 경우 — 출생연도로 세기 추정
    const yyNum = parseInt(yy, 10);
    century = yyNum <= 26 ? '20' : '19';
    gender = 'M'; // placeholder — 상세 페이지에서 보강 필요
  }

  // ssn_masked: 공백 제거 후 정규화 (원본 형식 유지)
  const ssn_masked = noSpace.replace(/^(\d{6})[-]?/, '$1-').slice(0, 14);

  return {
    birth_date: `${century}${yy}-${mm}-${dd}`,
    gender,
    ssn_masked,
  };
}

/**
 * 주민등록번호 원문을 파싱하여 마스킹 처리.
 * 원문은 이 함수 내에서만 사용하고 절대 반환하지 않음.
 *
 * @param ssn - "YYMMDD-NXXXXXX" 또는 "YYMMDDN" 형식
 * @returns ParsedSsn (원문 미포함)
 */
export function parseSsn(ssn: string): ParsedSsn {
  // 하이픈, 공백 제거 후 숫자만 추출
  const digits = ssn.replace(/[\s-]/g, '');

  if (digits.length < 7) {
    throw new Error('Invalid SSN format: too short');
  }

  const yy = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const dd = digits.slice(4, 6);
  const genderDigit = digits[6];

  // 성별 및 세기 판별
  const genderNum = parseInt(genderDigit, 10);
  let gender: 'M' | 'F';
  let century: string;

  if (genderNum === 9 || genderNum === 0) {
    century = '18';
    gender = genderNum === 9 ? 'M' : 'F';
  } else if (genderNum === 1 || genderNum === 2) {
    century = '19';
    gender = genderNum === 1 ? 'M' : 'F';
  } else if (genderNum === 3 || genderNum === 4) {
    century = '20';
    gender = genderNum === 3 ? 'M' : 'F';
  } else {
    throw new Error(`Invalid SSN gender digit: ${genderDigit}`);
  }

  const birth_date = `${century}${yy}-${mm}-${dd}`;
  const ssn_masked = `${yy}${mm}${dd}-${genderDigit}******`;

  return { birth_date, gender, ssn_masked };
}

/**
 * 전화번호 마스킹 (화면 표시용).
 * 원문은 DB에 저장하되, 화면에서는 이 함수를 통해 표시.
 *
 * 예: "01012345678" → "010-1234-****"
 * 예: "0212345678"  → "02-1234-****"
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11) {
    // 010-XXXX-XXXX
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-****`;
  } else if (digits.length === 10) {
    if (digits.startsWith('02')) {
      // 02-XXXX-XXXX
      return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-****`;
    }
    // 0XX-XXX-XXXX
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-****`;
  }

  // 알 수 없는 형식: 마지막 4자리만 마스킹
  return phone.slice(0, -4) + '****';
}

/**
 * 고객명 부분 마스킹 (화면 표시용).
 * 예: "홍길동" → "홍*동", "김철수" → "김**"
 */
export function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + '*';
  return name[0] + '*'.repeat(name.length - 2) + name[name.length - 1];
}

/**
 * 렌탈신청번호/메모 판별.
 * 숫자로만 구성된 경우 렌탈신청번호, 아니면 메모.
 */
export function parseRentalOrMemo(value: string | null): {
  rental_request_no: string | null;
  memo: string | null;
} {
  if (!value || value.trim() === '') {
    return { rental_request_no: null, memo: null };
  }

  const trimmed = value.trim();
  const isNumeric = /^\d+$/.test(trimmed);

  return {
    rental_request_no: isNumeric ? trimmed : null,
    memo: isNumeric ? null : trimmed,
  };
}
