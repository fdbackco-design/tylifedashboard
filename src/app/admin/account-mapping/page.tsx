/**
 * /admin/account-mapping
 *
 * organization_members ↔ user_profiles 정합성 진단 페이지.
 *
 * 네 가지 케이스를 한 화면에서 확인하고, 자동 복구 가능한 항목은 [복구] 버튼으로 처리한다.
 *  - 정산 데이터는 있는데 user_profiles 가 없는 영업자
 *  - user_profiles 가 비활성/옛 고객 노드를 가리키는 영업자
 *  - 동일 phone 을 가진 active 멤버 중복 후보
 *  - "[고객]" prefix 가 남아 있는 활성 영업자 노드
 *
 * 본 페이지는 정산 계산, 계약, 조직도 수동 편집 결과를 변경하지 않는다.
 * 변경 대상은 user_profiles.member_id / display_name 과 옛 임시 customer 노드의 is_active 뿐이다.
 */

import type { Metadata } from 'next';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { diagnoseMemberProfileIntegrity } from '@/lib/account-issue/member-profile-repair';
import AccountMappingClient from './AccountMappingClient';

export const metadata: Metadata = { title: '계정 매핑 진단' };
export const dynamic = 'force-dynamic';

export default async function AdminAccountMappingPage() {
  const db = createAdminSupabaseClient();
  const result = await diagnoseMemberProfileIntegrity(db);
  return (
    <div className="p-3 sm:p-6">
      <section className="mb-3 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:mb-4 sm:p-4">
        <div className="mb-3 border-b border-slate-100 pb-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-orange-700/85">관리자</p>
          <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">계정 매핑 진단</h1>
          <p className="mt-1 text-[11px] text-slate-500 sm:text-xs">
            organization_members ↔ user_profiles 정합성 어긋남을 한 번에 확인하고 복구합니다. 정산 계산 로직은 변경되지 않습니다.
          </p>
        </div>
        <AccountMappingClient
          noProfileButHasSettlement={result.noProfileButHasSettlement.map((r) => ({
            memberId: r.member.id,
            name: (r.member.name ?? '').replace(/^\[고객\]\s*/, '') || '—',
            rank: String(r.member.rank ?? ''),
            phone: r.member.phone ?? '',
            externalId: r.member.external_id ?? '',
            sourceCustomerId: r.member.source_customer_id ?? '',
            settlementYearMonth: r.settlementYearMonth ?? '',
            settlementTotal: r.settlementTotal,
          }))}
          profilePointsToLegacyMember={result.profilePointsToLegacyMember.map((r) => ({
            profileId: r.profileId,
            profileLoginCode: r.profileLoginCode ?? '',
            profileDisplayName: r.profileDisplayName ?? '',
            legacyMemberId: r.profileMemberId,
            legacyMemberName: r.profileMemberName ?? '',
            activeMemberId: r.activeMember.id,
            activeMemberName: (r.activeMember.name ?? '').replace(/^\[고객\]\s*/, ''),
            activeMemberRank: String(r.activeMember.rank ?? ''),
            activeMemberPhone: r.activeMember.phone ?? '',
            activeMemberSourceCustomerId: r.activeMember.source_customer_id ?? '',
          }))}
          duplicateActivePhones={result.duplicateActivePhones.map((r) => ({
            phoneDigits: r.phoneDigits,
            members: r.members.map((m) => ({
              memberId: m.id,
              name: (m.name ?? '').replace(/^\[고객\]\s*/, '') || '—',
              rank: String(m.rank ?? ''),
              externalId: m.external_id ?? '',
              sourceCustomerId: m.source_customer_id ?? '',
              createdAt: m.created_at,
            })),
          }))}
          legacyPrefixActiveMembers={result.legacyPrefixActiveMembers.map((m) => ({
            memberId: m.id,
            name: m.name ?? '',
            rank: String(m.rank ?? ''),
            phone: m.phone ?? '',
            externalId: m.external_id ?? '',
            sourceCustomerId: m.source_customer_id ?? '',
          }))}
        />
      </section>
    </div>
  );
}
