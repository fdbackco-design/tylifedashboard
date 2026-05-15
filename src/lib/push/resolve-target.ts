import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

type MemberRow = { id: string; name: string; rank: string | null };

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
        label = `${m.name}${m.rank ? ` ${m.rank}` : ''}`;
      }
    }
    return { userId: String((profile as { id: string }).id), label: label || trimmed };
  }

  const { data: members, error: memberErr } = await db
    .from('organization_members')
    .select('id, name, rank')
    .eq('name', trimmed)
    .eq('is_active', true);

  if (memberErr) throw new Error(memberErr.message);

  const rows = (members ?? []) as MemberRow[];
  if (rows.length === 0) {
    throw new Error(`'${trimmed}' 이름의 조직원을 찾을 수 없습니다.`);
  }
  if (rows.length > 1) {
    const hint = rows.map((m) => `${m.name} (${m.rank ?? '직급 없음'})`).join(', ');
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

  const label = `${member.name}${member.rank ? ` ${member.rank}` : ''}`;
  return { userId: activeProfiles[0]!.id, label };
}
