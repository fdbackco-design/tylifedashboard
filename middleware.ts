import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const ADMIN_COOKIE_NAME = 'admin_session';
const ADMIN_COOKIE_VALUE = 'admin_authed_v1';

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // /admin/login 같은 공개 페이지는 보호에서 제외
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next();
  }

  // 보호 대상: /admin/*
  if (!pathname.startsWith('/admin')) return NextResponse.next();

  const cookieVal = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (cookieVal === ADMIN_COOKIE_VALUE) return NextResponse.next();

  const redirectTo = `${pathname}${search}`;
  const loginUrl = new URL('/admin/login', req.url);
  loginUrl.searchParams.set('redirect', redirectTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*'],
};

