import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import OrganizationNavMenu from '@/components/organization/OrganizationNavMenu';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import PasswordChangeClient from './PasswordChangeClient';

export const metadata: Metadata = { title: '비밀번호 변경' };
export const dynamic = 'force-dynamic';

function loginIdFromEmail(email: string | null | undefined): string {
  const raw = (email ?? '').trim();
  const at = raw.indexOf('@');
  if (at <= 0) return '';
  return raw.slice(0, at);
}

export default async function OrganizationPasswordPage() {
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent('/organization/password')}`);
  }

  const { data: profile } = await userDb
    .from('user_profiles')
    .select('login_code')
    .eq('id', user.id)
    .maybeSingle();

  const loginId =
    ((profile?.login_code as string | null) ?? '').trim() || loginIdFromEmail(user.email);

  return (
    <div className="p-3 sm:p-6">
      <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <OrganizationNavMenu />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">비밀번호 변경</h1>
            <p className="mt-0.5 text-xs text-slate-500">로그인 아이디는 유지되며 비밀번호만 변경합니다.</p>
          </div>
        </div>
        <Link
          href="/organization"
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:min-h-10 sm:px-4 sm:text-sm"
        >
          홈으로
        </Link>
      </header>

      <div className="max-w-lg">
        <PasswordChangeClient loginId={loginId} />
      </div>
    </div>
  );
}
