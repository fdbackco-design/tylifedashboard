import type { Metadata } from 'next';
import { AdminShell } from './AdminShell';
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: { template: '%s | TY Life Dashboard', default: 'TY Life Dashboard' },
};

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/account-issue', label: '계정 발급' },
  { href: '/admin/contracts', label: '계약 관리' },
  { href: '/admin/organization', label: '조직도' },
  { href: '/admin/settlement', label: '정산 현황' },
] as const;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  // (Server Component) 권한 체크 후 렌더
  // NOTE: AdminShell은 Client Component이지만, 레이아웃 자체는 Server에서 선검증 가능
  return <AdminLayoutGuard>{children}</AdminLayoutGuard>;
}

async function AdminLayoutGuard(props: { children: React.ReactNode }) {
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?redirect=/admin');

  const { data: profile } = await db
    .from('user_profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .maybeSingle();

  const role = String((profile as any)?.role ?? 'member');
  const isActive = Boolean((profile as any)?.is_active ?? true);
  if (!isActive) redirect('/login');
  if (role !== 'admin') redirect('/organization');

  return <AdminShell navItems={[...NAV_ITEMS]}>{props.children}</AdminShell>;
}
