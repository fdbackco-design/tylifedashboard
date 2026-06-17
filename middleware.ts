import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

async function getAuthedUserIdAndRefreshSession(req: NextRequest): Promise<{
  userId: string | null;
  res: NextResponse;
}> {
  // 중요: Next.js App Router + SSR 환경에서 세션이 자주 풀리는 가장 흔한 원인은
  // 요청마다 Supabase가 refresh token을 사용해 쿠키를 갱신할 기회가 없어서다.
  // middleware에서 getUser()를 호출해 토큰 갱신(set-cookie)을 response에 반영한다.
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { userId: user?.id ?? null, res };
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 공개 페이지
  if (pathname === '/login' || pathname.startsWith('/login/')) {
    return NextResponse.next();
  }
  if (pathname === '/privacy' || pathname.startsWith('/privacy/')) {
    return NextResponse.next();
  }

  // API/정적 리소스는 제외
  if (pathname.startsWith('/api')) return NextResponse.next();
  if (pathname.startsWith('/_next')) return NextResponse.next();
  if (pathname.startsWith('/icons') || pathname === '/manifest.json' || pathname === '/sw.js') return NextResponse.next();

  // 로그인 필요: /privacy, /login 외 전부
  return (async () => {
    const { userId, res } = await getAuthedUserIdAndRefreshSession(req);
    if (userId) return res;

    const redirectTo = `${pathname}${search}`;
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', redirectTo);
    return NextResponse.redirect(loginUrl);
  })();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

