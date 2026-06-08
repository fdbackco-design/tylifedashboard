import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireOrganizationViewer } from '@/lib/organization/require-member';
import { fetchPublishedNoticeDetail } from '@/lib/notices/public-queries';
import OrganizationNavMenu from '@/components/organization/OrganizationNavMenu';
import KakaoChatbotFab from '../../KakaoChatbotFab';
import { MemberCategoryBadge } from '../notice-member-ui';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { id } = await props.params;
  const db = createAdminSupabaseClient();
  const detail = await fetchPublishedNoticeDetail(db, id, { incrementView: false });
  return { title: detail?.title ?? '공지사항' };
}

export default async function OrganizationNoticeDetailPage(props: Props) {
  const { id } = await props.params;
  const loginRedirect = `/login?redirect=${encodeURIComponent(`/organization/notice/${id}`)}`;
  // 사전 발급(PENDING) 계정도 공지사항은 볼 수 있어야 한다.
  await requireOrganizationViewer(loginRedirect);

  const db = createAdminSupabaseClient();
  let detail: Awaited<ReturnType<typeof fetchPublishedNoticeDetail>> = null;
  try {
    detail = await fetchPublishedNoticeDetail(db, id, { incrementView: true });
  } catch {
    detail = null;
  }

  if (!detail) notFound();

  return (
    <>
      <div className="min-h-[100dvh] bg-slate-50/80">
        <div className="mx-auto w-full max-w-lg bg-white min-h-[100dvh] shadow-sm ring-1 ring-slate-900/[0.04]">
          <header className="sticky top-0 z-20 border-b border-slate-100 bg-white">
            <div className="flex items-center gap-2 px-3 py-3">
              <OrganizationNavMenu />
              <Link
                href="/organization/notice"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                aria-label="목록으로"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </Link>
              <h1 className="flex-1 text-center text-base font-bold text-slate-900 pr-9">공지사항</h1>
            </div>
          </header>

          <article className="px-4 pb-8 pt-5 sm:px-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <MemberCategoryBadge category={detail.category} />
            </div>
            <h2 className="text-xl font-bold leading-snug text-slate-900 sm:text-2xl">{detail.title}</h2>

            <div className="mt-4 flex items-center gap-3 border-b border-slate-100 pb-4">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white"
                aria-hidden
              >
                관
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">관리자</p>
                <p className="text-xs text-slate-400">
                  {detail.display_date} · 조회 {detail.view_count.toLocaleString('ko-KR')}
                </p>
              </div>
            </div>

            <div
              className="notice-body prose prose-sm max-w-none text-[15px] leading-relaxed text-slate-700 sm:text-base [&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_p]:my-3"
              dangerouslySetInnerHTML={{ __html: detail.content_html }}
            />

            {detail.attachments.length > 0 ? (
              <div className="mt-6 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">첨부파일</p>
                {detail.attachments.map((a) => (
                  <a
                    key={a.id}
                    href={`/api/notices/${detail.id}/attachments/${a.id}`}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:border-orange-200 hover:bg-orange-50/30"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{a.file_name}</p>
                      <p className="text-xs text-slate-400">{formatBytes(a.file_size)}</p>
                    </div>
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 shrink-0 text-slate-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                    </svg>
                  </a>
                ))}
              </div>
            ) : null}

            <nav className="mt-8 divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
              {detail.prev ? (
                <Link
                  href={`/organization/notice/${detail.prev.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="shrink-0 text-xs font-medium text-slate-400 w-8">이전</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{detail.prev.title}</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5l-7 7 7 7" />
                  </svg>
                </Link>
              ) : null}
              {detail.next ? (
                <Link
                  href={`/organization/notice/${detail.next.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                >
                  <span className="shrink-0 text-xs font-medium text-slate-400 w-8">다음</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{detail.next.title}</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5l7 7-7 7" />
                  </svg>
                </Link>
              ) : null}
            </nav>

            <Link
              href="/organization/notice"
              className="mt-6 flex w-full items-center justify-center rounded-xl border border-orange-300 bg-white py-3.5 text-sm font-semibold text-orange-600 transition hover:bg-orange-50"
            >
              목록으로 돌아가기
            </Link>
          </article>
        </div>
      </div>
      <KakaoChatbotFab />
    </>
  );
}
