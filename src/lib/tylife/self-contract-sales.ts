import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeCustomerIdentityName,
  normalizeCustomerIdentityPhone,
} from '@/lib/organization/customer-identity';

type MappedAccountIdentity = {
  member_id?: string | null;
  display_name: string | null;
  pre_issued_name: string | null;
  phone: string | null;
  pre_issued_phone: string | null;
};

export type AccountBackedMemberIdentity = {
  id: string;
  name: string | null;
  phone: string | null;
};

export function mappedAccountMatchesMemberIdentity(
  account: MappedAccountIdentity,
  member: { name: string | null; phone: string | null },
): boolean {
  const accountName = normalizeCustomerIdentityName(account.pre_issued_name ?? account.display_name);
  const accountPhone = normalizeCustomerIdentityPhone(account.pre_issued_phone ?? account.phone);
  const memberName = normalizeCustomerIdentityName(member.name);
  const memberPhone = normalizeCustomerIdentityPhone(member.phone);
  return !!accountName && !!accountPhone && accountName === memberName && accountPhone === memberPhone;
}

export const mappedAccountMatchesSelfContract = mappedAccountMatchesMemberIdentity;

export async function findAccountBackedCustomerMemberIds(
  db: SupabaseClient,
  members: AccountBackedMemberIdentity[],
): Promise<Set<string>> {
  if (members.length === 0) return new Set();
  const memberById = new Map(members.map((member) => [member.id, member]));
  const { data, error } = await db
    .from('user_profiles')
    .select('member_id, display_name, pre_issued_name, phone, pre_issued_phone')
    .in('member_id', members.map((member) => member.id))
    .eq('role', 'member')
    .eq('is_active', true);
  if (error) throw new Error(`담당자 계정 조회 실패: ${error.message}`);

  const matchingCountByMemberId = new Map<string, number>();
  for (const account of (data ?? []) as MappedAccountIdentity[]) {
    const memberId = account.member_id ?? null;
    const member = memberId ? memberById.get(memberId) : null;
    if (!member || !mappedAccountMatchesMemberIdentity(account, member)) continue;
    matchingCountByMemberId.set(member.id, (matchingCountByMemberId.get(member.id) ?? 0) + 1);
  }

  return new Set(
    Array.from(matchingCountByMemberId.entries())
      .filter(([, count]) => count === 1)
      .map(([memberId]) => memberId),
  );
}

/**
 * 고객과 담당자 이름이 같은 자기계약에서만 사용한다.
 * 고객 노드에 실제 활성 영업자 계정이 연결되어 있고 계정 이름·전화번호가 고객과 일치할 때,
 * 해당 customer:* 노드를 동일 인물의 영업자 노드로 재사용한다.
 */
export async function isMappedAccountSelfContractMember(
  db: SupabaseClient,
  args: { memberId: string; customerName: string; customerPhone: string | null },
): Promise<boolean> {
  const { data, error } = await db
    .from('user_profiles')
    .select('display_name, pre_issued_name, phone, pre_issued_phone')
    .eq('member_id', args.memberId)
    .eq('role', 'member')
    .eq('is_active', true)
    .limit(2);
  if (error) throw new Error(`자기계약 영업자 계정 조회 실패: ${error.message}`);

  const accounts = (data ?? []) as MappedAccountIdentity[];
  if (accounts.length !== 1) return false;
  return mappedAccountMatchesSelfContract(accounts[0], {
    name: args.customerName,
    phone: args.customerPhone,
  });
}
