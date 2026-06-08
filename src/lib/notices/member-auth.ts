import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

function createRequestSupabaseClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {},
      },
    },
  );
}

export async function isOrganizationMemberAuthed(req: NextRequest): Promise<boolean> {
  const supabase = createRequestSupabaseClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  return Boolean(profile?.is_active ?? true) && Boolean(profile?.member_id);
}

/**
 * 공지사항(목록/상세/이미지/첨부) 같이 member_id 가 없어도 접근을 허용해야 하는
 * 화면을 위한 느슨한 인증.
 *
 * - 로그인된 user_profiles 행이 존재하고 비활성화되지 않았으면 통과
 * - member_id 가 NULL 인 사전 발급(PENDING) 계정도 통과
 *
 * 영업 데이터(/organization 등)에 사용해서는 안 된다. 공지 리소스에만 사용.
 */
export async function isOrganizationViewerAuthed(req: NextRequest): Promise<boolean> {
  const supabase = createRequestSupabaseClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle();

  // user_profiles 행이 없으면 정상 영업자 계정이 아니므로 차단
  if (!profile) return false;
  return Boolean(profile.is_active ?? true);
}
