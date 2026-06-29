/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import PushSubscribeButton from '@/components/push/PushSubscribeButton';

function ShieldMini(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={props.className ?? 'h-3 w-3'}>
      <path
        d="M12 3l7 3v6c0 4.5-3.5 8.5-7 9-3.5-.5-7-4.5-7-9V6l7-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type NavItem = { href: string; label: string };

const TY_LIFE_CONTRACT_URL = 'https://n.ty-life.co.kr/contract/';

function ExternalLinkIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className ?? 'h-4 w-4'}
    >
      <path
        d="M14 3h7v7M10 14L21 3M21 14v6a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1h6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TyLifeContractLinkButton() {
  return (
    <a
      href={TY_LIFE_CONTRACT_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-full items-center justify-center gap-2 rounded-md border border-orange-500/50 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-500 active:bg-orange-700"
    >
      <ExternalLinkIcon />
      태양 라이프 계약
    </a>
  );
}

function AdminLogoutButton(props: { className?: string; compact?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function logout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.assign('/login?redirect=/admin');
    }
  }

  return (
    <button
      type="button"
      disabled={isLoggingOut}
      onClick={logout}
      className={
        props.className ??
        (props.compact
          ? 'shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50'
          : 'w-full rounded-md border border-slate-600 bg-slate-900/40 px-3 py-2 text-sm font-medium text-slate-100 hover:bg-slate-700 hover:border-slate-500 disabled:opacity-50')
      }
    >
      {isLoggingOut ? '로그아웃 중…' : '로그아웃'}
    </button>
  );
}

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
  /** 데스크톱 사이드바: TY Life 텍스트 대신 파트너 로고 */
  brandAsLogo?: boolean;
  /** 푸시 구독 토글에 사용할 VAPID public key (서버에서 layout 으로 전달) */
  vapidPublicKey?: string;
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
    <aside className="flex h-full min-h-0 w-full flex-col bg-slate-800 text-slate-200">
      <div className="shrink-0 border-b border-slate-700 px-5 py-5">
        {props.brandAsLogo ? (
          <Link
            href="/admin"
            prefetch={true}
            onClick={props.onNavigate}
            className="block outline-none ring-offset-2 ring-offset-slate-800 focus-visible:ring-2 focus-visible:ring-orange-400/80"
          >
            <Image
              src="/ty-life-partners-logo.png"
              alt="TY Life Partners"
              width={440}
              height={176}
              priority
              className="h-10 w-auto max-w-[9.25rem] object-contain object-left"
            />
          </Link>
        ) : (
          <h1 className="text-lg font-bold text-white">TY Life</h1>
        )}
        <p className="text-xs text-slate-400 mt-0.5">계약·정산 관리</p>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
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
      <div className="shrink-0 space-y-3 border-t border-slate-700 bg-slate-800 px-4 py-3">
        <TyLifeContractLinkButton />
        {props.vapidPublicKey ? (
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-slate-200">
            <PushSubscribeButton vapidPublicKey={props.vapidPublicKey} />
          </div>
        ) : null}
        <AdminLogoutButton />
        <p className="text-xs text-slate-500">관리자 전용</p>
      </div>
    </aside>
  );
}

export function AdminShell(props: {
  navItems: NavItem[];
  children: React.ReactNode;
  /** 푸시 구독에 사용할 VAPID public key. server layout 에서 전달. */
  vapidPublicKey?: string;
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
    <div className="min-h-screen md:flex md:items-stretch">
      {/* 모바일 상단바 */}
      <header className="fixed left-0 right-0 top-0 z-40 h-14 border-b border-slate-200/90 bg-white/90 backdrop-blur md:hidden">
        <div className="flex h-full items-center gap-3 px-4">
          <button
            type="button"
            aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
            className="-ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-slate-100 active:bg-slate-200"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <CloseIcon /> : <HamburgerIcon />}
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <Link
              href="/admin"
              className="block min-h-[1.75rem] min-w-0 max-w-[min(100%,12rem)] shrink"
              prefetch={true}
            >
              <Image
                src="/logo.png"
                alt="TY Life Partners"
                width={200}
                height={56}
                priority
                className="h-7 max-h-8 w-auto max-w-full object-contain object-left sm:h-8"
              />
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-slate-900/[0.04]">
                <ShieldMini />
                Admin
              </span>
              {props.vapidPublicKey ? (
                <PushSubscribeButton vapidPublicKey={props.vapidPublicKey} compact />
              ) : null}
              <AdminLogoutButton compact />
            </div>
          </div>
        </div>
      </header>

      {/* 데스크톱 고정 사이드바 — 바깥 컬럼은 페이지 높이만큼 bg를 이어 주고, 안쪽은 sticky */}
      <div className="hidden md:block md:w-56 md:shrink-0 md:self-stretch bg-slate-800">
        <div className="sticky top-0 h-screen w-56">
          <SidebarContents navItems={props.navItems} brandAsLogo vapidPublicKey={props.vapidPublicKey} />
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
            vapidPublicKey={props.vapidPublicKey}
          />
        </div>
      </div>

      {/* 메인 콘텐츠 — 모바일은 영역 내 스크롤, 데스크톱은 페이지 스크롤(좌측 배경 연속) */}
      <main className="flex-1 min-w-0 overflow-auto pt-14 md:overflow-visible md:pt-0">
        {props.children}
      </main>
    </div>
  );
}

