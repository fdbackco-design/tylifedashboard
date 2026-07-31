import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeCustomerIdentityName,
  normalizeCustomerIdentityPhone,
} from '@/lib/organization/customer-identity';

type MappedAccountIdentity = {
  display_name: string | null;
  pre_issued_name: string | null;
  phone: string | null;
  pre_issued_phone: string | null;
};

export function mappedAccountMatchesSelfContract(
  account: MappedAccountIdentity,
  customer: { name: string | null; phone: string | null },
): boolean {
  const accountName = normalizeCustomerIdentityName(account.pre_issued_name ?? account.display_name);
  const accountPhone = normalizeCustomerIdentityPhone(account.pre_issued_phone ?? account.phone);
  const customerName = normalizeCustomerIdentityName(customer.name);
  const customerPhone = normalizeCustomerIdentityPhone(customer.phone);
  return !!accountName && !!accountPhone && accountName === customerName && accountPhone === customerPhone;
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
