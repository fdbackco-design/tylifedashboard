import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { template: '%s | TY Life Dashboard', default: 'TY Life Dashboard' },
};

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드' },
  { href: '/admin/contracts', label: '계약 관리' },
  { href: '/admin/pending-sales', label: '담당 미확인' },
  { href: '/admin/pending-contractor', label: '편입 매핑 대기' },
  { href: '/admin/organization', label: '조직도' },
  { href: '/admin/settlement', label: '정산 현황' },
] as const;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* 사이드바 */}
      <aside className="w-56 shrink-0 bg-slate-800 text-slate-200 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-700">
          <h1 className="text-lg font-bold text-white">TY Life</h1>
          <p className="text-xs text-slate-400 mt-0.5">계약·정산 관리</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              className="block px-3 py-2 rounded-md text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-700">
          <p className="text-xs text-slate-500">관리자 전용</p>
        </div>
      </aside>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
