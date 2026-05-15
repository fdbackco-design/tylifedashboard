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

export async function getAuthedUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const supabase = createRequestSupabaseClient(req);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profile && (profile as { is_active?: boolean }).is_active === false) return null;
  return user.id;
}
