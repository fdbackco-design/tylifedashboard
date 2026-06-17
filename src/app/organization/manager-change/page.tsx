import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import OrganizationNavMenu from '@/components/organization/OrganizationNavMenu';
import { createAdminSupabaseClient, createServerSupabaseClient } from '@/lib/supabase/server';
import { formatPhoneDisplay } from '@/lib/manager-change/format';
import ManagerChangeClient from './ManagerChangeClient';

export const metadata: Metadata = { title: '담당자 변경' };
export const dynamic = 'force-dynamic';

export default async function ManagerChangePage() {
  const userDb = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userDb.auth.getUser();
  if (!user) {
    redirect(`/login?redirect=${encodeURIComponent('/organization/manager-change')}`);
  }

  const { data: profile } = await userDb
    .from('user_profiles')
    .select('member_id, display_name, phone')
    .eq('id', user.id)
    .maybeSingle();

  const memberId = (profile?.member_id as string | null) ?? null;
  const displayName = (profile?.display_name as string | null) ?? '';
  let requesterPhone = (profile?.phone as string | null) ?? '';

  const adminDb = createAdminSupabaseClient();
  if (memberId && !requesterPhone) {
    const { data: m } = await adminDb
      .from('organization_members')
      .select('name, phone')
      .eq('id', memberId)
      .maybeSingle();
    requesterPhone = (m as { phone?: string | null } | null)?.phone ?? '';
  }

  let requesterName = displayName.trim();
  if (!requesterName && memberId) {
    const { data: m } = await adminDb
      .from('organization_members')
      .select('name')
      .eq('id', memberId)
      .maybeSingle();
    requesterName = ((m as { name?: string } | null)?.name ?? '').replace(/^\[고객\]\s*/, '').trim();
  }

  const phoneDigits = requesterPhone.replace(/\D/g, '');
  const requesterPhoneDisplay = phoneDigits ? formatPhoneDisplay(phoneDigits) : '';

  const { data: initialItems } = await adminDb
    .from('manager_change_requests')
    .select(
      'id, contract_id, customer_name, contract_codes, item_name, after_manager_name, after_manager_phone, status, created_at, completed_at',
    )
    .eq('requester_user_id', user.id)
    .order('created_at', { ascending: false });

  return (
    <div className="p-3 sm:p-6">
      <header className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <OrganizationNavMenu />
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-slate-900 sm:text-xl">담당자 변경</h1>
            <p className="mt-0.5 text-xs text-slate-500">본인 산하 계약의 담당자 변경을 신청합니다.</p>
          </div>
        </div>
        <Link
          href="/organization"
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 sm:min-h-10 sm:px-4 sm:text-sm"
        >
          홈으로
        </Link>
      </header>

      <ManagerChangeClient
        initialItems={(initialItems ?? []) as any}
        canSubmit={!!memberId}
        requesterName={requesterName || '—'}
        requesterPhone={requesterPhoneDisplay}
      />
    </div>
  );
}
