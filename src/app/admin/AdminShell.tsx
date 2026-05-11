/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type NavItem = { href: string; label: string };

function HamburgerIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className ?? 'h-6 w-6'}
    >
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className ?? 'h-6 w-6'}
    >
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SidebarContents(props: {
  navItems: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const activeHref = useMemo(() => {
    // exact match 우선, 그 다음은 prefix match (예: /admin/contracts/123 -> /admin/contracts)
    const exact = props.navItems.find((n) => n.href === pathname)?.href;
    if (exact) return exact;
    const prefix = props.navItems
      .filter((n) => n.href !== '/admin')
      .find((n) => pathname?.startsWith(n.href));
    return prefix?.href ?? null;
  }, [pathname, props.navItems]);

  return (
    <aside className="h-full w-64 bg-slate-800 text-slate-200 flex flex-col">
      <div className="px-5 py-5 border-b border-slate-700">
        <h1 className="text-lg font-bold text-white">TY Life</h1>
        <p className="text-xs text-slate-400 mt-0.5">계약·정산 관리</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {props.navItems.map((item) => {
          const isActive = activeHref === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={true}
              onClick={props.onNavigate}
              className={[
                'block px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-700 hover:text-white',
              ].join(' ')}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 border-t border-slate-700">
        <p className="text-xs text-slate-500">관리자 전용</p>
      </div>
    </aside>
  );
}

export function AdminShell(props: {
  navItems: NavItem[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  // 라우트 이동 시 자동 닫힘 (Link onClick이 실패해도 안전)
  const pathname = usePathname();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // ESC로 닫기
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="min-h-screen md:flex">
      {/* 모바일 상단바 */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-white/90 backdrop-blur border-b border-gray-200">
        <div className="h-full px-4 flex items-center gap-3">
          <button
            type="button"
            aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
            className="inline-flex items-center justify-center h-10 w-10 -ml-2 rounded-md hover:bg-gray-100 active:bg-gray-200"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <CloseIcon /> : <HamburgerIcon />}
          </button>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">
              TY Life Dashboard
            </div>
            <div className="text-xs text-gray-500 truncate">관리자</div>
          </div>
        </div>
      </header>

      {/* 데스크톱 고정 사이드바 */}
      <div className="hidden md:block md:w-56 md:shrink-0">
        <div className="h-full w-56">
          <SidebarContents navItems={props.navItems} />
        </div>
      </div>

      {/* 모바일 드로어 */}
      <div
        className={[
          'md:hidden fixed inset-0 z-50',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
        aria-hidden={!open}
      >
        {/* 오버레이 */}
        <div
          className={[
            'absolute inset-0 bg-black/40 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          onClick={() => setOpen(false)}
        />

        {/* 패널 */}
        <div
          className={[
            'absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] transition-transform',
            open ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
        >
          <SidebarContents
            navItems={props.navItems}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 min-w-0 overflow-auto pt-14 md:pt-0">
        {props.children}
      </main>
    </div>
  );
}

