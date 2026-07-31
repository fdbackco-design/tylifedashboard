import {
  normalizeCustomerIdentityBirthDate,
  normalizeCustomerIdentityName,
  normalizeCustomerIdentityPhone,
} from '@/lib/organization/customer-identity';

type ManualCustomerMapIdentityInput = {
  profileName: string | null | undefined;
  profilePhone: string | null | undefined;
  issuedBirthDate: string | null | undefined;
  customerName: string | null | undefined;
  customerPhone: string | null | undefined;
  customerBirthDate: string | null | undefined;
};

export type ManualCustomerMapIdentityResult =
  | { ok: true }
  | { ok: false; reason: 'NAME_MISMATCH' | 'PHONE_MISSING' | 'PHONE_MISMATCH' | 'BIRTH_DATE_MISSING' | 'BIRTH_DATE_MISMATCH' };

/**
 * 계정 발급 대상자를 customer:* 노드에 수동 매핑할 때도 고객 병합 정책과 동일하게
 * 이름·전화번호·생년월일 완전 일치를 요구한다.
 */
export function validateManualCustomerMapIdentity(
  input: ManualCustomerMapIdentityInput,
): ManualCustomerMapIdentityResult {
  const profileName = normalizeCustomerIdentityName(input.profileName);
  const customerName = normalizeCustomerIdentityName(input.customerName);
  if (!profileName || !customerName || profileName !== customerName) {
    return { ok: false, reason: 'NAME_MISMATCH' };
  }

  const profilePhone = normalizeCustomerIdentityPhone(input.profilePhone);
  const customerPhone = normalizeCustomerIdentityPhone(input.customerPhone);
  if (!profilePhone || !customerPhone) return { ok: false, reason: 'PHONE_MISSING' };
  if (profilePhone !== customerPhone) return { ok: false, reason: 'PHONE_MISMATCH' };

  const issuedBirthDate = normalizeCustomerIdentityBirthDate(input.issuedBirthDate);
  const customerBirthDate = normalizeCustomerIdentityBirthDate(input.customerBirthDate);
  if (!issuedBirthDate || !customerBirthDate) return { ok: false, reason: 'BIRTH_DATE_MISSING' };
  if (issuedBirthDate !== customerBirthDate) return { ok: false, reason: 'BIRTH_DATE_MISMATCH' };

  return { ok: true };
}
