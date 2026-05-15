'use client';

import type { PublishedNoticeListItem } from '@/lib/notices/public-queries';
import { NOTICE_CATEGORIES } from '@/lib/notices/constants';
import type { NoticeCategory } from '@/lib/notices/constants';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MemberCategoryBadge } from './notice-member-ui';

const TABS = ['전체', ...NOTICE_CATEGORIES] as const;
type Tab = (typeof TABS)[number];

type Props = {
  items: PublishedNoticeListItem[];
};

export default function NoticeListClient({ items }: Props) {
  const [tab, setTab] = useState<Tab>('전체');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    let rows = items;
    if (tab !== '전체') {
      rows = rows.filter((r) => r.category === (tab as NoticeCategory));
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter(
        (r) => r.title.toLowerCase().includes(needle) || r.summary.toLowerCase().includes(needle),
      );
    }
    return rows;
  }, [items, tab, q]);

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 pb-3 pt-2 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2">
          <label className="sr-only" htmlFor="notice-search">
            공지 검색
          </label>
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3-3" />
            </svg>
            <input
              id="notice-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="검색"
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100"
            />
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                tab === t
                  ? 'bg-orange-50 text-orange-600 ring-1 ring-orange-200/80'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <li className="px-4 py-16 text-center text-sm text-slate-500">표시할 공지가 없습니다.</li>
        ) : (
          filtered.map((row) => (
            <li key={row.id}>
              <Link
                href={`/organization/notice/${row.id}`}
                className="block px-4 py-4 transition hover:bg-orange-50/30 active:bg-orange-50/50"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <MemberCategoryBadge category={row.category} />
                  {row.is_new ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-red-500">NEW</span>
                  ) : null}
                </div>
                <h2 className="text-[15px] font-bold leading-snug text-slate-900 line-clamp-2">{row.title}</h2>
                {row.summary ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500 line-clamp-2">{row.summary}</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-400">{row.display_date}</p>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
