export type CustomerIdentityInput = {
  name: string | null | undefined;
  phone: string | null | undefined;
  birthDate: string | null | undefined;
};

export function normalizeCustomerIdentityName(value: string | null | undefined): string {
  return (value ?? '').replace(/^\[고객\]\s*/, '').trim();
}

export function normalizeCustomerIdentityPhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export function normalizeCustomerIdentityBirthDate(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(0, 8) : '';
}

/**
 * 동명이인 자동 병합은 이름·전화번호·생년월일이 모두 있을 때만 허용한다.
 * 값 하나라도 없으면 null을 반환해 별도 고객 노드 생성을 유도한다.
 */
export function buildCustomerIdentityKey(input: CustomerIdentityInput): string | null {
  const name = normalizeCustomerIdentityName(input.name);
  const phone = normalizeCustomerIdentityPhone(input.phone);
  const birthDate = normalizeCustomerIdentityBirthDate(input.birthDate);
  if (!name || !phone || !birthDate) return null;
  return `${name}|${phone}|${birthDate}`;
}
