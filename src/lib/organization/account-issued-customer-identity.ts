import {
  buildCustomerIdentityKey,
  normalizeCustomerIdentityName,
} from '@/lib/organization/customer-identity';

export type IssuedIdentityRequest = {
  employee_id: string | null;
  name: string;
  phone_digits: string;
  birth_date: string;
};

export type IssuedIdentityProfile = {
  member_id: string | null;
  login_code: string;
};

export type IssuedIdentityMember = {
  id: string;
  name: string;
  rank: string;
};

export function accountLoginCodesForIssuedRequest(
  request: Pick<IssuedIdentityRequest, 'employee_id' | 'phone_digits'>,
): string[] {
  const phoneDigits = String(request.phone_digits ?? '').replace(/\D/g, '');
  const last8 = phoneDigits.length >= 8 ? phoneDigits.slice(-8) : '';
  return [
    String(request.employee_id ?? '').trim().toLowerCase(),
    last8,
    last8 ? `fed${last8}` : '',
  ].filter(Boolean);
}

/**
 * 발급 완료 신청서(employee_id) → 발급 계정(login_code) → 담당자 노드(member_id)를 연결한다.
 * 신청서의 이름·전화번호·생년월일이 고객과 모두 같고 최종 멤버가 한 명일 때만 자동 병합한다.
 */
export function resolveAccountIssuedMemberForCustomer(params: {
  customer: { name: string; phone: string | null; birthDate: string | null };
  requests: IssuedIdentityRequest[];
  profiles: IssuedIdentityProfile[];
  members: IssuedIdentityMember[];
}): string | null {
  const customerKey = buildCustomerIdentityKey(params.customer);
  if (!customerKey) return null;

  const matchingLoginCodes = new Set<string>();
  for (const request of params.requests) {
    if (
      buildCustomerIdentityKey({
        name: request.name,
        phone: request.phone_digits,
        birthDate: request.birth_date,
      }) !== customerKey
    ) {
      continue;
    }
    for (const loginCode of accountLoginCodesForIssuedRequest(request)) {
      matchingLoginCodes.add(loginCode);
    }
  }
  if (matchingLoginCodes.size === 0) return null;

  const memberById = new Map(params.members.map((member) => [member.id, member]));
  const matchedMemberIds = new Set<string>();
  for (const profile of params.profiles) {
    const loginCode = String(profile.login_code ?? '').trim().toLowerCase();
    if (!profile.member_id || !matchingLoginCodes.has(loginCode)) continue;
    const member = memberById.get(profile.member_id);
    if (!member || member.rank === '본사') continue;
    if (normalizeCustomerIdentityName(member.name) !== normalizeCustomerIdentityName(params.customer.name)) {
      continue;
    }
    matchedMemberIds.add(member.id);
  }

  return matchedMemberIds.size === 1 ? matchedMemberIds.values().next().value ?? null : null;
}
