import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function hasSupabaseSessionCookie(req: NextRequest): boolean {
  // supabase/ssr 쿠키 이름은 프로젝트마다 prefix가 달라질 수 있어 패턴으로 탐지한다.
  // 예: sb-<project-ref>-auth-token
  for (const c of req.cookies.getAll()) {
    const name = c.name ?? '';
    if (name.endsWith('-auth-token') && name.startsWith('sb-')) return true;
    if (name === 'sb-access-token' || name === 'sb-refresh-token') return true;
  }
  return false;
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
  if (hasSupabaseSessionCookie(req)) return NextResponse.next();

  const redirectTo = `${pathname}${search}`;
  const loginUrl = new URL('/login', req.url);
  loginUrl.searchParams.set('redirect', redirectTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

