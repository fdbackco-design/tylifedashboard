export type SalesCodeIssuanceInput = {
  birthDate: string | null | undefined;
  gender: string | null | undefined;
  phone: string | null | undefined;
};

export type SalesCodeIssuanceValues = {
  employeeId: string;
  residentNumber: string;
  phoneDigits: string;
  formattedPhone: string;
  initialPassword: string;
};

export function normalizeIssuancePhone(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '');
}

export function formatIssuancePhone(phone: string | null | undefined): string {
  const digits = normalizeIssuancePhone(phone);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

export function createEmployeeId(phone: string | null | undefined): string {
  const digits = normalizeIssuancePhone(phone);
  if (!/^0\d{9,10}$/.test(digits)) {
    throw new Error('휴대폰번호 형식이 올바르지 않습니다.');
  }
  return `fed${digits.slice(-8)}`;
}

function normalizeBirthDate(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) {
    throw new Error('생년월일 정보가 없거나 형식이 올바르지 않습니다.');
  }
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error('생년월일 정보가 올바르지 않습니다.');
  }
  return digits;
}

export function createResidentNumber(
  birthDate: string | null | undefined,
  gender: string | null | undefined,
): string {
  const birth = normalizeBirthDate(birthDate);
  const normalizedGender = String(gender ?? '').trim();
  if (normalizedGender !== '남' && normalizedGender !== '여') {
    throw new Error('성별 정보가 없거나 올바르지 않습니다.');
  }
  const year = Number(birth.slice(0, 4));
  const discriminator =
    year < 2000
      ? normalizedGender === '남' ? '1' : '2'
      : normalizedGender === '남' ? '3' : '4';
  return `${birth.slice(2)}-${discriminator}000000`;
}

export function buildSalesCodeIssuanceValues(
  input: SalesCodeIssuanceInput,
): SalesCodeIssuanceValues {
  const phoneDigits = normalizeIssuancePhone(input.phone);
  const employeeId = createEmployeeId(phoneDigits);
  return {
    employeeId,
    residentNumber: createResidentNumber(input.birthDate, input.gender),
    phoneDigits,
    formattedPhone: formatIssuancePhone(phoneDigits),
    initialPassword: phoneDigits,
  };
}

export function formatKstDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatKstMonthDay(date = new Date()): string {
  return formatKstDate(date).slice(5);
}
