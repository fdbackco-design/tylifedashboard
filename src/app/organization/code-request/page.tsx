import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import OrganizationNavMenu from '@/components/organization/OrganizationNavMenu';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import CodeRequestClient from './CodeRequestClient';

export const metadata: Metadata = { title: '영업자 코드 발급 신청' };
export const dynamic = 'force-dynamic';

export default async function CodeRequestPage() {
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent('/organization/code-request')}`);
  }

  const { data: profile } = await userDb
    .from('user_profiles')
    .select('member_id, display_name')
    .eq('id', user.id)
    .maybeSingle();
  const memberId = (profile?.member_id as string | null) ?? null;
  const displayName = (profile?.display_name as string | null) ?? null;

  const adminDb = createAdminSupabaseClient();
  const { data: initialItems } = await adminDb
    .from('sales_code_requests')
    .select(
      'id, name, birth_date, gender, phone, has_own_contract, memo, status, requested_at, synced_to_sheet, sheet_synced_at, rejection_reason, rejected_at',
    )
    .eq('applicant_user_id', user.id)
    .order('requested_at', { ascending: false });

  return (
    <div className="p-3 sm:p-6">
      <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <OrganizationNavMenu />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">영업자 코드 발급 신청</h1>
            <p className="mt-0.5 text-xs text-slate-500">
              본인 산하 영업자의 TY 코드 발급을 신청합니다.
              {displayName ? ` (신청자: ${displayName})` : null}
            </p>
          </div>
        </div>
        <Link
          href="/organization"
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:min-h-10 sm:px-4 sm:text-sm"
        >
          홈으로
        </Link>
      </header>

      <CodeRequestClient
        initialItems={(initialItems ?? []) as any}
        canSubmit={!!memberId}
      />
    </div>
  );
}
