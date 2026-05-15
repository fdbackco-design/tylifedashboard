import type { NoticeCategory } from '@/lib/notices/constants';

export const MEMBER_CATEGORY_STYLES: Record<NoticeCategory, string> = {
  일반: 'bg-slate-100 text-slate-600',
  중요: 'bg-orange-50 text-orange-600',
  웨비나: 'bg-slate-100 text-slate-600',
  승급: 'bg-slate-100 text-slate-600',
};

export function MemberCategoryBadge({ category }: { category: NoticeCategory }) {
  const important = category === '중요';
  return (
    <span className="inline-flex items-center gap-1">
      {important ? (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-orange-500" fill="currentColor" aria-hidden>
          <path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z" />
        </svg>
      ) : null}
      <span
        className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${MEMBER_CATEGORY_STYLES[category]}`}
      >
        {category}
      </span>
    </span>
  );
}
