import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import YearMonthSelector from '@/components/YearMonthSelector';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import {
  coalesceYearMonthSearchParam,
  getSettlementWindowSeoul,
  normalizeYearMonthLabel,
} from '@/lib/settlement/settlement-window';
import TyLifePartnersLogo from '@/components/TyLifePartnersLogo';
import AccountActionsClient from './AccountActionsClient';
import OrganizationDetailsFirstClient from './OrganizationDetailsFirstClient';
import KakaoChatbotFab from './KakaoChatbotFab';
import OrganizationNavMenu from '@/components/organization/OrganizationNavMenu';
import PushSubscribeButton from '@/components/push/PushSubscribeButton';
import { getVapidPublicKey } from '@/lib/push/vapid';
import { buildMyOrganizationTreeViewModel } from './my-org-tree-view-model';

export const metadata: Metadata = { title: '내 조직도' };
export const dynamic = 'force-dynamic';

function loginRedirectPath(yearMonth: string) {
  return `/login?redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`;
}

export default async function OrganizationMyTreePage({
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
    redirect(loginRedirectPath(yearMonth));
  }

  const { data: profile, error: profileErr } = await userDb
    .from('user_profiles')
    .select('member_id,is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    redirect(`/login?error=profile&redirect=${encodeURIComponent(`/organization?year_month=${yearMonth}`)}`);
  }

  const memberId = profile?.member_id as string | null;

  if (!memberId) {
    return (
      <div className="p-6 max-w-lg">
        <TyLifePartnersLogo className="mb-5" mobileSrc="/logo.png" />
        <p className="text-sm text-red-600">이 계정은 조직도에 연결된 권한(member_id)이 없습니다.</p>
        <Link className="text-sm text-blue-600 underline mt-2 inline-block" href="/login">
          로그인으로 돌아가기
        </Link>
      </div>
    );
  }

  const vm = await buildMyOrganizationTreeViewModel(adminDb, { memberId, yearMonth });
  const {
    label_year_month,
    start_date,
    end_date,
    yearsForPicker,
    greetingDisplayName,
    greetingDisplayRank,
    treeForDisplay,
    contractsByMember,
    periodPendingTreeContractCount,
    totalJoinUnits,
    periodJoinUnits,
    basisYear,
    basisMonth,
  } = vm;

  return (
    <>
    <div className="p-3 sm:p-6">
      <header className="mb-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-5">
        <div className="relative border-b border-orange-100/70 bg-gradient-to-br from-orange-50/90 via-white to-slate-50/50 px-3 py-3 sm:px-5 sm:py-4">
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-orange-200/25 blur-2xl sm:-right-4 sm:-top-6"
            aria-hidden
          />
          <div className="relative flex items-start gap-2.5 sm:gap-3">
            <OrganizationNavMenu />
            <p className="min-w-0 flex-1 text-[1.35rem] font-bold leading-snug tracking-tight text-orange-700 sm:text-2xl sm:leading-tight">
              {greetingDisplayRank
                ? `${greetingDisplayName} ${greetingDisplayRank}님 환영합니다`
                : `${greetingDisplayName}님 환영합니다`}
            </p>
            <PushSubscribeButton vapidPublicKey={getVapidPublicKey()} compact />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100/90 bg-gradient-to-r from-slate-50 to-white px-3 py-2 sm:px-4 sm:py-2.5">
          <TyLifePartnersLogo mobileSrc="/logo.png" density="compact" />
          <div className="min-w-0 text-right">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400">정산 기준월</p>
            <p className="text-base font-semibold tabular-nums tracking-tight text-slate-900 sm:text-lg">
              {basisYear}년 {basisMonth}월
            </p>
            <p className="mt-0.5 hidden text-[11px] text-slate-500 sm:block">
              {start_date} ~ {end_date}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 p-2 sm:gap-2 sm:p-3">
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5">
            <p className="text-[10px] font-medium leading-tight text-slate-400 sm:text-[11px] sm:leading-snug">
              <span className="sm:hidden">준비·대기</span>
              <span className="hidden sm:inline">선택달 준비·대기</span>
            </p>
            <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:mt-2 sm:text-xl">
              {periodPendingTreeContractCount.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">건</span>
            </p>
            <p className="mt-auto pt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{label_year_month}</p>
          </div>
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5">
            <p className="text-[10px] font-medium leading-tight text-slate-400 sm:text-[11px]">
              <span className="sm:hidden">누적 가입</span>
              <span className="hidden sm:inline">누적 가입 구좌</span>
            </p>
            <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:mt-2 sm:text-xl">
              {totalJoinUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
          </div>
          <div className="flex min-h-0 flex-col rounded-xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/80 px-2 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.06)] sm:px-2.5 sm:py-2.5">
            <p className="text-[10px] font-medium leading-tight text-slate-400 sm:text-[11px] sm:leading-snug">
              <span className="sm:hidden">당월 가입</span>
              <span className="hidden sm:inline">선택달 가입 구좌</span>
            </p>
            <p className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-slate-900 sm:mt-2 sm:text-xl">
              {periodJoinUnits.toLocaleString('ko-KR')}
              <span className="ml-0.5 text-[11px] font-semibold text-slate-500 sm:text-xs">구좌</span>
            </p>
            <p className="mt-auto pt-1 text-[9px] leading-tight text-slate-400 sm:text-[10px]">{label_year_month}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/40 px-2 py-2 sm:gap-3 sm:px-3 sm:py-2">
          <Link
            href={`/organization/statement?year_month=${encodeURIComponent(yearMonth)}`}
            className="flex min-h-9 min-w-0 flex-1 items-center justify-center rounded-lg bg-gradient-to-b from-orange-500 to-orange-600 px-3 text-xs font-semibold text-white shadow-sm shadow-orange-900/15 ring-1 ring-orange-400/25 transition hover:from-orange-600 hover:to-orange-700 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 sm:min-h-10 sm:text-sm"
          >
            명세서 보기
          </Link>
          <div className="shrink-0">
            <AccountActionsClient
              showChangePassword={false}
              showPrivacyPolicy={false}
              redirectAfterLogout={loginRedirectPath(yearMonth)}
            />
          </div>
        </div>
      </header>

      <div className="mb-3 sm:mb-4">
        <h2 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">내 조직도</h2>
        <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
          정산 기간 {start_date} ~ {end_date}
        </p>
      </div>

      <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-5 sm:p-4">
        <div className="mb-3 flex flex-col gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <Link
            href={`/organization/tree?year_month=${encodeURIComponent(yearMonth)}`}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-orange-500 to-orange-600 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-orange-900/15 ring-1 ring-orange-400/25 transition hover:from-orange-600 hover:to-orange-700 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 sm:px-4 sm:py-2 sm:text-sm"
          >
            조직도 보기
          </Link>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
          <YearMonthSelector
            layout="compact-toolbar"
            className="min-w-0 flex-1 sm:min-w-[min(100%,22rem)]"
            value={yearMonth}
            todayValue={defaultYearMonth}
            years={yearsForPicker}
            todayLabel="오늘 기준월"
          />
        </div>
      </section>

      <OrganizationDetailsFirstClient
        roots={treeForDisplay}
        contractsByMember={contractsByMember}
        defaultMemberId={memberId}
      />
    </div>
    <KakaoChatbotFab />
    </>
  );
}
