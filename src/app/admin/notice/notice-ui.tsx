import type { NoticeCategory } from '@/lib/notices/constants';
import type { NoticeDisplayStatus } from '@/lib/notices/types';
import { NOTICE_STATUS_LABEL } from '@/lib/notices/status';

export const CATEGORY_STYLES: Record<NoticeCategory, string> = {
  일반: 'bg-slate-100 text-slate-700',
  중요: 'bg-red-50 text-red-700',
  웨비나: 'bg-blue-50 text-blue-700',
  승급: 'bg-orange-50 text-orange-800',
};

export const STATUS_STYLES: Record<NoticeDisplayStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-sky-50 text-sky-700',
  published: 'bg-emerald-50 text-emerald-700',
  stopped: 'bg-red-50 text-red-600',
};

export function CategoryBadge({ category }: { category: NoticeCategory }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[category]}`}
    >
      {category}
    </span>
  );
}

export function StatusBadge({ status }: { status: NoticeDisplayStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {NOTICE_STATUS_LABEL[status]}
    </span>
  );
}
