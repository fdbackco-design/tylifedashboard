'use client';

import LoadingButton from '@/components/ui/LoadingButton';
import { NOTICE_CATEGORIES, NOTICE_PAGE_SIZE } from '@/lib/notices/constants';
import { formatNoticeDateYmd } from '@/lib/notices/status';
import type { NoticeListItem } from '@/lib/notices/types';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SimpleAlertModal from '@/components/ui/SimpleAlertModal';
import DeleteNoticeModal from './DeleteNoticeModal';
import { CategoryBadge, StatusBadge } from './notice-ui';

type DeleteModalState =
  | { mode: 'single'; item: NoticeListItem }
  | { mode: 'bulk'; count: number };

type ListResponse = {
  success: boolean;
  data?: {
    items: NoticeListItem[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats: { total: number; publishedApprox: number };
  };
  error?: string;
};

export default function NoticeManagementClient() {
  const [items, setItems] = useState<NoticeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [publishedApprox, setPublishedApprox] = useState(0);
  const [q, setQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteSuccessModal, setDeleteSuccessModal] = useState<{ message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const sp = new URLSearchParams();
      if (q) sp.set('q', q);
      if (category !== 'all') sp.set('category', category);
      sp.set('page', String(page));
      const res = await fetch(`/api/admin/notices?${sp.toString()}`);
      const json = (await res.json()) as ListResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? '목록 조회 실패');
      setItems(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
      setTotalPages(json.data?.totalPages ?? 1);
      setPublishedApprox(json.data?.stats.publishedApprox ?? 0);
      setSelected(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, category, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((r) => r.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkAction(action: 'stop' | 'delete') {
    const ids = [...selected];
    if (!ids.length) return;
    if (action === 'delete') {
      setDeleteModal({ mode: 'bulk', count: ids.length });
      return;
    }

    setBulkLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/notices/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? '처리 실패');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteModal) return;

    setDeleteLoading(true);
    setErr(null);
    try {
      if (deleteModal.mode === 'single') {
        const res = await fetch(`/api/admin/notices/${deleteModal.item.id}`, { method: 'DELETE' });
        const json = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || !json.success) throw new Error(json.error ?? '삭제 실패');
        setDeleteModal(null);
        setDeleteSuccessModal({ message: `「${deleteModal.item.title}」 공지가 삭제되었습니다.` });
      } else {
        const ids = [...selected];
        const res = await fetch('/api/admin/notices/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', ids }),
        });
        const json = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || !json.success) throw new Error(json.error ?? '삭제 실패');
        setDeleteModal(null);
        setDeleteSuccessModal({ message: `선택한 ${ids.length}건의 공지가 삭제되었습니다.` });
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteLoading(false);
    }
  }

  const pageButtons = useMemo(() => {
    const pages: number[] = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let p = start; p <= end; p++) pages.push(p);
    return pages;
  }, [page, totalPages]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs text-slate-500">전체 공지</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{total}</p>
        </div>
        <div className="rounded-xl border border-orange-100 bg-orange-50/50 px-4 py-3 shadow-sm">
          <p className="text-xs text-orange-800/80">게시 중(대략)</p>
          <p className="mt-1 text-2xl font-bold text-orange-950 tabular-nums">{publishedApprox}</p>
        </div>
        <div className="col-span-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:col-span-1">
          <p className="text-xs text-slate-500">페이지당</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{NOTICE_PAGE_SIZE}건</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQ(searchInput.trim());
          }}
        >
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="제목 검색"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 sm:max-w-xs"
          />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
          >
            <option value="all">전체 분류</option>
            {NOTICE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <LoadingButton
            type="submit"
            isLoading={loading}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            검색
          </LoadingButton>
        </form>
        <Link
          href="/admin/notice/new"
          className="inline-flex items-center justify-center rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-600"
        >
          + 공지 등록
        </Link>
      </div>

      {someSelected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-200 bg-orange-50/60 px-3 py-2">
          <span className="text-sm text-orange-900">{selected.size}건 선택</span>
          <LoadingButton
            type="button"
            isLoading={bulkLoading}
            onClick={() => void bulkAction('stop')}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            게시 중지
          </LoadingButton>
          <LoadingButton
            type="button"
            isLoading={bulkLoading}
            onClick={() => void bulkAction('delete')}
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            삭제
          </LoadingButton>
        </div>
      ) : null}

      {err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : loading ? (
        <p className="text-sm text-slate-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-slate-500">등록된 공지가 없습니다.</p>
          <Link href="/admin/notice/new" className="mt-3 inline-block text-sm font-medium text-orange-600 hover:underline">
            첫 공지 등록하기
          </Link>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="min-w-full text-sm">
              <thead className="bg-orange-50/70 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="전체 선택" />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">분류</th>
                  <th className="px-3 py-2 text-left font-medium">제목</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">게시기간</th>
                  <th className="px-3 py-2 text-center font-medium">고정</th>
                  <th className="px-3 py-2 text-right font-medium">관리</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        aria-label={`${row.title} 선택`}
                      />
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <CategoryBadge category={row.category} />
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {row.is_pinned ? (
                          <span className="text-[10px] font-bold uppercase text-orange-600">PIN</span>
                        ) : null}
                        <span className="font-medium text-slate-900 line-clamp-1">{row.title}</span>
                        {row.attachment_count > 0 ? (
                          <span className="text-xs text-slate-400">📎{row.attachment_count}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <StatusBadge status={row.display_status} />
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                      {formatPublishRange(row.publish_start, row.publish_end)}
                    </td>
                    <td className="px-3 py-3 text-center text-slate-400">{row.is_pinned ? '●' : '—'}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/admin/notice/${row.id}/edit`}
                        className="text-orange-600 hover:underline font-medium"
                      >
                        수정
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteModal({ mode: 'single', item: row })}
                        className="ml-3 text-red-600 hover:underline font-medium"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {items.map((row) => (
              <article
                key={row.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleOne(row.id)}
                    className="mt-1"
                    aria-label={`${row.title} 선택`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CategoryBadge category={row.category} />
                      <StatusBadge status={row.display_status} />
                      {row.is_pinned ? (
                        <span className="text-[10px] font-bold text-orange-600">상단고정</span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 font-semibold text-slate-900 line-clamp-2">{row.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatPublishRange(row.publish_start, row.publish_end)}
                      {row.attachment_count > 0 ? ` · 첨부 ${row.attachment_count}` : ''}
                    </p>
                    <div className="mt-3 flex gap-3">
                      <Link
                        href={`/admin/notice/${row.id}/edit`}
                        className="text-sm font-medium text-orange-600"
                      >
                        수정
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDeleteModal({ mode: 'single', item: row })}
                        className="text-sm font-medium text-red-600"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {totalPages > 1 ? (
        <nav className="flex flex-wrap items-center justify-center gap-1" aria-label="페이지">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            이전
          </button>
          {pageButtons.map((p) => (
            <button
              key={p}
              type="button"
              disabled={loading}
              onClick={() => setPage(p)}
              className={`min-w-[2.25rem] rounded-lg border px-3 py-1.5 text-sm ${
                p === page
                  ? 'border-orange-400 bg-orange-50 font-semibold text-orange-800'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            다음
          </button>
        </nav>
      ) : null}

      <DeleteNoticeModal
        open={deleteModal !== null}
        title={deleteModal?.mode === 'single' ? deleteModal.item.title : ''}
        bulkCount={deleteModal?.mode === 'bulk' ? deleteModal.count : undefined}
        loading={deleteLoading}
        onCancel={() => {
          if (!deleteLoading) setDeleteModal(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
      <SimpleAlertModal
        open={deleteSuccessModal !== null}
        variant="success"
        title="삭제 완료"
        message={deleteSuccessModal?.message ?? ''}
        onClose={() => setDeleteSuccessModal(null)}
      />
    </div>
  );
}

function formatPublishRange(start: string | null, end: string | null): string {
  const s = formatNoticeDateYmd(start);
  const e = formatNoticeDateYmd(end);
  if (!s && !e) return '상시';
  if (s && e) return `${s} ~ ${e}`;
  if (s) return `${s} ~`;
  return `~ ${e}`;
}
