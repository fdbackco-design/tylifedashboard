import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireOrganizationMember } from '@/lib/organization/require-member';
import { fetchPublishedNoticesForMember, mapPublishedListItem } from '@/lib/notices/public-queries';
import TyLifePartnersLogo from '@/components/TyLifePartnersLogo';
import OrganizationNavMenu from '@/components/organization/OrganizationNavMenu';
import KakaoChatbotFab from '../KakaoChatbotFab';
import NoticeListClient from './NoticeListClient';

export const metadata: Metadata = { title: '공지사항' };
export const dynamic = 'force-dynamic';

export default async function OrganizationNoticeListPage() {
  const loginRedirect = '/login?redirect=' + encodeURIComponent('/organization/notice');
  const memberCtx = await requireOrganizationMember(loginRedirect);

  if (!memberCtx) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <TyLifePartnersLogo className="mb-5" mobileSrc="/logo.png" />
        <p className="text-sm text-red-600">이 계정은 조직도에 연결된 권한(member_id)이 없습니다.</p>
        <Link className="mt-2 inline-block text-sm text-blue-600 underline" href="/organization">
          내 조직도로
        </Link>
      </div>
    );
  }

  const db = createAdminSupabaseClient();
  let items: ReturnType<typeof mapPublishedListItem>[] = [];
  let loadError: string | null = null;
  try {
    const rows = await fetchPublishedNoticesForMember(db);
    items = rows.map(mapPublishedListItem);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <div className="min-h-[100dvh] bg-slate-50/80">
        <div className="mx-auto w-full max-w-lg bg-white min-h-[100dvh] shadow-sm ring-1 ring-slate-900/[0.04]">
          <header className="sticky top-0 z-20 border-b border-slate-100 bg-white">
            <div className="relative flex items-center justify-center px-3 py-3">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <OrganizationNavMenu />
              </div>
              <h1 className="text-base font-bold text-slate-900">공지사항</h1>
            </div>
          </header>

          {loadError ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-red-600">{loadError}</p>
              <p className="mt-2 text-xs text-slate-500">잠시 후 다시 시도해주세요.</p>
            </div>
          ) : (
            <NoticeListClient items={items} />
          )}
        </div>
      </div>
      <KakaoChatbotFab />
    </>
  );
}
