import type { NextRequest } from 'next/server';

export const ADMIN_COOKIE_NAME = 'admin_session';
export const ADMIN_COOKIE_VALUE = 'admin_authed_v1';

export function isAdminAuthed(req: NextRequest): boolean {
  const cookieVal = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  return cookieVal === ADMIN_COOKIE_VALUE;
}

