import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneDigits } from '@/lib/sales-code/notify';

/** 재신청을 허용하지 않는 상태 (반려만 재신청 가능) */
const ACTIVE_REQUEST_STATUSES = ['신청중', '시트등록완료', '처리완료'] as const;

export type PhoneDuplicateResult =
  | { duplicate: false }
  | { duplicate: true; reason: 'request' | 'account'; message: string };

/**
 * 영업자 코드 발급 신청용 전화번호 중복 검사.
 * 1) sales_code_requests (신청중/시트등록완료/처리완료)
 * 2) user_profiles (계정 발급 페이지에서 발급된 영업자 계정 전화)
 */
export async function findSalesCodePhoneDuplicate(
  db: SupabaseClient,
  phoneDigits: string,
  options?: { excludeRequestId?: string | null },
): Promise<PhoneDuplicateResult> {
  const digits = normalizePhoneDigits(phoneDigits);
  if (digits.length < 10) {
    return { duplicate: false };
  }

  // 1) 기존 신청
  let reqQuery = db
    .from('sales_code_requests')
    .select('id')
    .eq('phone_digits', digits)
    .in('status', [...ACTIVE_REQUEST_STATUSES])
    .limit(1);

  if (options?.excludeRequestId) {
    reqQuery = reqQuery.neq('id', options.excludeRequestId);
  }

  const { data: reqRows, error: reqErr } = await reqQuery;
  if (reqErr) {
    throw new Error(`전화번호 중복 확인 실패(신청): ${reqErr.message}`);
  }
  if (reqRows && reqRows.length > 0) {
    return {
      duplicate: true,
      reason: 'request',
      message: '이미 신청된 전화번호입니다. 다른 번호로 신청해주세요.',
    };
  }

  // 2) 발급된 영업자 계정
  // organization_members에는 계정이 없는 고객 노드도 있으므로 중복 검사 대상으로 사용하지 않는다.
  // phone 저장 형식이 제각각이라 끝 4자리로 후보를 좁힌 뒤 숫자만으로 정확 비교한다.
  const last4 = digits.slice(-4);
  const { data: accountRows, error: accountErr } = await db
    .from('user_profiles')
    .select('id, phone, pre_issued_phone')
    .eq('role', 'member')
    .or(`phone.ilike.%${last4}%,pre_issued_phone.ilike.%${last4}%`)
    .limit(100);

  if (accountErr) {
    throw new Error(`전화번호 중복 확인 실패(발급 계정): ${accountErr.message}`);
  }

  const hit = ((accountRows ?? []) as Array<{
    id: string;
    phone: string | null;
    pre_issued_phone: string | null;
  }>).find(
    (r) =>
      normalizePhoneDigits(r.phone) === digits ||
      normalizePhoneDigits(r.pre_issued_phone) === digits,
  );
  if (hit) {
    return {
      duplicate: true,
      reason: 'account',
      message: '이미 발급된 영업자 계정의 전화번호입니다. 신청할 수 없습니다.',
    };
  }

  return { duplicate: false };
}
