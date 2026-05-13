import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  // /admin/login 진입점 제거: /login으로 통합
  const url = new URL(req.url);
  return NextResponse.redirect(new URL('/login?redirect=/admin', url));
}

