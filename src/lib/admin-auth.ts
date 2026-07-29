import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';

export type AuthedUserProfile = {
  id: string;
  role: string;
  is_active: boolean;
  display_name: string | null;
};

function createRequestSupabaseClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        // Route Handler에서 token refresh 시 쿠키 갱신이 필요할 수 있지만,
        // 현재는 "인가 체크" 용도라 no-op로 둔다.
        setAll() {},
      },
    },
  );
}

export async function getAuthedUserProfileFromRequest(
  req: NextRequest,
): Promise<AuthedUserProfile | null> {
  const supabase = createRequestSupabaseClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role,is_active,display_name')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;
  return {
    id: user.id,
    role: String((profile as any).role ?? ''),
    is_active: Boolean((profile as any).is_active ?? false),
    display_name: typeof (profile as any).display_name === 'string'
      ? (profile as any).display_name
      : null,
  };
}

export async function isAdminAuthed(req: NextRequest): Promise<boolean> {
  const profile = await getAuthedUserProfileFromRequest(req);
  return Boolean(profile?.is_active) && profile?.role === 'admin';
}

