import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneDigits } from '@/lib/sales-code/notify';

/** 재신청을 허용하지 않는 상태 (반려만 재신청 가능) */
const ACTIVE_REQUEST_STATUSES = ['신청중', '시트등록완료', '처리완료'] as const;

export type PhoneDuplicateResult =
  | { duplicate: false }
  | { duplicate: true; reason: 'request' | 'member'; message: string };

/**
 * 영업자 코드 발급 신청용 전화번호 중복 검사.
 * 1) sales_code_requests (신청중/시트등록완료/처리완료)
 * 2) organization_members (이미 등록된 영업자 전화)
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

  // 2) 이미 등록된 영업자 (phone 저장 형식이 제각각이라 끝 4자리로 후보를 좁힌 뒤 정확 비교)
  const last4 = digits.slice(-4);
  const { data: memberRows, error: memErr } = await db
    .from('organization_members')
    .select('id, phone')
    .not('phone', 'is', null)
    .neq('rank', '본사')
    .ilike('phone', `%${last4}%`)
    .limit(100);

  if (memErr) {
    throw new Error(`전화번호 중복 확인 실패(영업자): ${memErr.message}`);
  }

  const hit = ((memberRows ?? []) as Array<{ id: string; phone: string | null }>).find(
    (r) => normalizePhoneDigits(r.phone) === digits,
  );
  if (hit) {
    return {
      duplicate: true,
      reason: 'member',
      message: '이미 등록된 영업자 전화번호입니다. 신청할 수 없습니다.',
    };
  }

  return { duplicate: false };
}
