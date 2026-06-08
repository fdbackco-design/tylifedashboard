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

export type OrganizationViewerContext = {
  userId: string;
  /** member_id 가 아직 매핑되지 않았으면 null (사전 발급 PENDING 계정 등) */
  memberId: string | null;
  displayName: string | null;
  mappingStatus: 'PENDING' | 'MATCHED' | 'MANUAL_REVIEW' | null;
  isActive: boolean;
};

/**
 * 로그인된 영업자 화면 뷰어 컨텍스트.
 * - 공지사항처럼 member_id 가 없어도 진입 가능한 화면을 위한 헬퍼.
 * - user_profiles 행이 없거나 비활성화 상태면 로그인 화면으로 보낸다.
 */
export async function requireOrganizationViewer(loginRedirect: string): Promise<OrganizationViewerContext> {
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();

  if (!user) redirect(loginRedirect);

  const { data: profile, error } = await userDb
    .from('user_profiles')
    .select('member_id,is_active,display_name,mapping_status')
    .eq('id', user.id)
    .maybeSingle();

  if (error) redirect(`/login?error=profile&redirect=${encodeURIComponent(loginRedirect)}`);
  if (!profile) redirect(`/login?error=profile&redirect=${encodeURIComponent(loginRedirect)}`);

  const isActive = Boolean((profile as { is_active?: boolean | null }).is_active ?? true);
  if (!isActive) redirect(loginRedirect);

  return {
    userId: user.id,
    memberId: ((profile as { member_id?: string | null }).member_id ?? null) as string | null,
    displayName: ((profile as { display_name?: string | null }).display_name ?? null) as string | null,
    mappingStatus: (((profile as { mapping_status?: string | null }).mapping_status ?? null) as
      | 'PENDING'
      | 'MATCHED'
      | 'MANUAL_REVIEW'
      | null),
    isActive,
  };
}
