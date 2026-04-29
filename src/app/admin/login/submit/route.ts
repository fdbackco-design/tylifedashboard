import { NextResponse } from 'next/server';

const ADMIN_ID = 'admin';
const ADMIN_PW = '0703';

const ADMIN_COOKIE_NAME = 'admin_session';
const ADMIN_COOKIE_VALUE = 'admin_authed_v1';

export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get('id') ?? '');
  const pw = String(form.get('pw') ?? '');

  const url = new URL(req.url);
  const redirectTo = url.searchParams.get('redirect') ?? '/admin';

  if (id !== ADMIN_ID || pw !== ADMIN_PW) {
    const loginUrl = new URL('/admin/login', url);
    loginUrl.searchParams.set('error', '1');
    return NextResponse.redirect(loginUrl);
  }

  // NextResponse.redirect는 절대 URL/URL 객체만 허용
  const redirectTarget = new URL(redirectTo, url);
  const res = NextResponse.redirect(redirectTarget);
  res.cookies.set(ADMIN_COOKIE_NAME, ADMIN_COOKIE_VALUE, {
    httpOnly: true,
    sameSite: 'lax',
    // API 호출은 /api/admin/* 경로이므로 path를 /로 둬야 쿠키가 전달됨
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24, // 24시간
  });
  return res;
}

