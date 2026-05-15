import type { SupabaseClient } from '@supabase/supabase-js';
import { stripCustomerMemberNamePrefix } from '@/lib/dashboard/display-format';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

type MemberRow = { id: string; name: string; rank: string | null };

/** 입력·DB 모두 `[고객]` 접두어 제거 후 비교용 */
function normalizeMemberLookupName(input: string): string {
  return stripCustomerMemberNamePrefix(input.trim());
}

/**
 * organization_members.name 조회 (is_active=true).
 * DB에 `[고객] 홍길동`으로 저장된 경우 입력 `홍길동`과 매칭한다.
 */
async function findActiveMembersByDisplayName(
  db: SupabaseClient,
  input: string,
): Promise<MemberRow[]> {
  const normalized = normalizeMemberLookupName(input);
  if (!normalized) return [];

  const exactNames = [...new Set([normalized, `[고객] ${normalized}`, input.trim()])];

  const { data: exact, error: exactErr } = await db
    .from('organization_members')
    .select('id, name, rank')
    .eq('is_active', true)
    .in('name', exactNames);

  if (exactErr) throw new Error(exactErr.message);

  let rows = ((exact ?? []) as MemberRow[]).filter(
    (m) => normalizeMemberLookupName(m.name) === normalized,
  );

  if (rows.length > 0) return rows;

  const { data: prefixed, error: prefixErr } = await db
    .from('organization_members')
    .select('id, name, rank')
    .eq('is_active', true)
    .ilike('name', `[고객]%${normalized}%`);

  if (prefixErr) throw new Error(prefixErr.message);

  rows = ((prefixed ?? []) as MemberRow[]).filter(
    (m) => normalizeMemberLookupName(m.name) === normalized,
  );

  return rows;
}

/**
 * 사용자 ID(UUID) 또는 조직원 이름으로 push_subscriptions.user_id(auth)를 조회한다.
 */
export async function resolvePushTargetUserId(
  db: SupabaseClient,
  input: string,
): Promise<{ userId: string; label: string }> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('대상 사용자를 입력해주세요.');
  }

  if (isUuid(trimmed)) {
    const { data: profile, error } = await db
      .from('user_profiles')
      .select('id, display_name, member_id')
      .eq('id', trimmed)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!profile) throw new Error('대상 사용자를 찾을 수 없습니다.');

    let label = String((profile as { display_name?: string | null }).display_name ?? '').trim();
    const memberId = (profile as { member_id?: string | null }).member_id;
    if (memberId) {
      const { data: member } = await db
        .from('organization_members')
        .select('name, rank')
        .eq('id', memberId)
        .maybeSingle();
      if (member) {
        const m = member as { name: string; rank: string | null };
        label = `${normalizeMemberLookupName(m.name)}${m.rank ? ` ${m.rank}` : ''}`;
      }
    }
    return { userId: String((profile as { id: string }).id), label: label || trimmed };
  }

  const normalized = normalizeMemberLookupName(trimmed);
  const rows = await findActiveMembersByDisplayName(db, trimmed);

  if (rows.length === 0) {
    throw new Error(`'${normalized || trimmed}' 이름의 조직원을 찾을 수 없습니다.`);
  }
  if (rows.length > 1) {
    const hint = rows
      .map((m) => `${normalizeMemberLookupName(m.name)} (${m.rank ?? '직급 없음'})`)
      .join(', ');
    throw new Error(`동명이인이 ${rows.length}명 있습니다. 사용자 ID로 지정하거나 계정을 확인해주세요. (${hint})`);
  }

  const member = rows[0]!;
  const { data: profiles, error: profileErr } = await db
    .from('user_profiles')
    .select('id, is_active')
    .eq('member_id', member.id)
    .eq('is_active', true);

  if (profileErr) throw new Error(profileErr.message);

  const activeProfiles = (profiles ?? []) as { id: string }[];
  if (activeProfiles.length === 0) {
    throw new Error(`'${trimmed}' 님은 로그인 계정이 발급되지 않았거나 비활성 상태입니다.`);
  }

  const displayName = normalizeMemberLookupName(member.name);
  const label = `${displayName}${member.rank ? ` ${member.rank}` : ''}`;
  return { userId: activeProfiles[0]!.id, label };
}
