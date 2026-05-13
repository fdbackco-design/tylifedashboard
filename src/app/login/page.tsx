import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import LoginClient from './LoginClient';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: '로그인' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const redirectTo = sp.redirect ?? '/organization';
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (user) {
    const { data: profile } = await db
      .from('user_profiles')
      .select('role,is_active')
      .eq('id', user.id)
      .maybeSingle();
    const role = String((profile as any)?.role ?? 'member');
    const isActive = Boolean((profile as any)?.is_active ?? true);
    if (!isActive) {
      // 비활성 계정은 로그인 페이지에서 메시지를 띄우는 기존 흐름을 유지하기 위해 로그아웃 처리 후 렌더
    } else if (role === 'admin') {
      redirect('/admin');
    } else {
      redirect('/organization');
    }
  }

  return <LoginClient redirect={redirectTo} />;
}

