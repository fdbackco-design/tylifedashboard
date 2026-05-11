import type { Metadata } from 'next';
import { AdminShell } from './AdminShell';

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
  return (
    <AdminShell navItems={[...NAV_ITEMS]}>{children}</AdminShell>
  );
}
