import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type OrganizationMemberContext = {
  userId: string;
  memberId: string;
};

/** 로그인 + member_id 연결 계정. 실패 시 redirect 또는 null(연결 없음). */
export async function requireOrganizationMember(loginRedirect: string): Promise<OrganizationMemberContext | null> {
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();

  if (!user) redirect(loginRedirect);

  const { data: profile, error } = await userDb
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error) redirect(`/login?error=profile&redirect=${encodeURIComponent(loginRedirect)}`);

  const memberId = (profile?.member_id as string | null) ?? null;
  if (!memberId) return null;

  return { userId: user.id, memberId };
}
