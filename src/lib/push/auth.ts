import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

type CookieToSet = { name: string; value: string; options: CookieOptions };

function createRequestSupabaseClient(req: NextRequest, cookiesToSet: CookieToSet[]) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(next: CookieToSet[]) {
          next.forEach((cookie) => cookiesToSet.push(cookie));
        },
      },
    },
  );
}

function applyCookies(res: NextResponse, cookiesToSet: CookieToSet[]): NextResponse {
  cookiesToSet.forEach(({ name, value, options }) => {
    res.cookies.set(name, value, options);
  });
  return res;
}

export async function getAuthedUserIdFromRequest(req: NextRequest): Promise<{
  userId: string | null;
  withAuthCookies: (res: NextResponse) => NextResponse;
}> {
  const cookiesToSet: CookieToSet[] = [];
  const supabase = createRequestSupabaseClient(req, cookiesToSet);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const withAuthCookies = (res: NextResponse) => applyCookies(res, cookiesToSet);

  if (!user) return { userId: null, withAuthCookies };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profile && (profile as { is_active?: boolean }).is_active === false) {
    return { userId: null, withAuthCookies };
  }
  return { userId: user.id, withAuthCookies };
}
