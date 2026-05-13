import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function safeRedirectTarget(v: string | null): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s.startsWith('/')) return null;
  // 외부 URL 방지
  if (s.startsWith('//')) return null;
  // 공개 페이지로의 리다이렉트는 허용하지만, /admin은 admin만 최종 도달 가능
  return s;
}

export default async function LoginRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const requested = safeRedirectTarget(sp.redirect ?? null);

  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    redirect(requested ? `/login?redirect=${encodeURIComponent(requested)}` : '/login');
  }

  const { data: profile } = await db
    .from('user_profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .maybeSingle();

  const role = String((profile as any)?.role ?? 'member');
  const isActive = Boolean((profile as any)?.is_active ?? true);

  if (!isActive) {
    redirect('/login');
  }

  if (role === 'admin') {
    // admin만 /admin 허용. requested가 /admin 계열이면 그대로, 아니면 /admin 고정.
    if (requested && requested.startsWith('/admin')) redirect(requested);
    redirect('/admin');
  }

  // 일반 사용자: /admin 접근 시 /organization으로 강제
  if (requested && !requested.startsWith('/admin')) {
    redirect(requested);
  }
  redirect('/organization');
}

