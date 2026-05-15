import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import OrgTree from '@/components/org-tree/OrgTree';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import TyLifePartnersLogo from '@/components/TyLifePartnersLogo';
import AccountActionsClient from '../AccountActionsClient';
import { buildMyOrganizationTreeViewModel } from '../my-org-tree-view-model';

export const metadata: Metadata = { title: '조직도 보기' };
export const dynamic = 'force-dynamic';

function treeLoginRedirect(yearMonth: string) {
  return `/login?redirect=${encodeURIComponent(`/organization/tree?year_month=${yearMonth}`)}`;
}

export default async function OrganizationTreePage({
  searchParams,
}: {
  searchParams?: Promise<{ year_month?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const defaultYearMonth = getSettlementWindowSeoul().label_year_month;
  const requestedYearMonthRaw =
    coalesceYearMonthSearchParam(sp.year_month as string | string[] | undefined) ?? defaultYearMonth;
  const yearMonth = normalizeYearMonthLabel(requestedYearMonthRaw) ?? defaultYearMonth;

  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();
  const adminDb = createAdminSupabaseClient();

  if (!user) {
    redirect(treeLoginRedirect(yearMonth));
  }

  const { data: profile, error: profileErr } = await userDb
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    redirect(`/login?error=profile&redirect=${encodeURIComponent(`/organization/tree?year_month=${yearMonth}`)}`);
  }

  const memberId = profile?.member_id as string | null;
  if (!memberId) {
    return (
      <div className="p-6 max-w-lg">
        <TyLifePartnersLogo className="mb-5" mobileSrc="/logo.png" />
        <p className="text-sm text-red-600">이 계정은 조직도에 연결된 권한(member_id)이 없습니다.</p>
        <Link className="mt-2 inline-block text-sm text-blue-600 underline" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    );
  }

  const vm = await buildMyOrganizationTreeViewModel(adminDb, { memberId, yearMonth });
  const {
    start_date,
    end_date,
    yearsForPicker,
    treeForDisplay,
    contractsByMember,
    orgMetricsById,
    basisYear,
    basisMonth,
  } = vm;

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-slate-900 sm:text-xl">조직도 보기</h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">
            {basisYear}년 {basisMonth}월 · {start_date} ~ {end_date}
          </p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2 sm:shrink-0">
          <Link
            href={`/organization?year_month=${encodeURIComponent(yearMonth)}`}
            className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:flex-initial sm:min-h-10 sm:px-4 sm:text-sm"
          >
            홈으로 돌아가기
          </Link>
          <div className="flex min-h-9 items-center justify-center sm:min-h-10">
            <AccountActionsClient
              showChangePassword={false}
              showPrivacyPolicy={false}
              redirectAfterLogout={treeLoginRedirect(yearMonth)}
            />
          </div>
        </div>
      </div>

      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-5 sm:p-4">
        <YearMonthSelector
          layout="compact-toolbar"
          className="min-w-0"
          value={yearMonth}
          todayValue={defaultYearMonth}
          years={yearsForPicker}
          todayLabel="오늘 기준월"
        />
      </section>

      <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
        <OrgTree
          roots={treeForDisplay}
          contractsByMember={contractsByMember}
          metricsById={orgMetricsById as any}
          editable={false}
          showMetrics={false}
          showForecast={true}
          hideHqRoot={true}
          contractDetailPresentation="bottom-sheet"
          contractDetailHideProductAndContractCode
        />
      </div>
    </div>
  );
}
