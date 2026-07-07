import type { Metadata } from 'next';
import Link from 'next/link';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { extractMemberName } from '@/lib/utils/normalize-member-name';
import PreIssuedCodeMembersClient from './pre-issued-code-members-client';

export const metadata: Metadata = { title: '코드 선발급자 관리' };
export const dynamic = 'force-dynamic';

type Status = 'active' | 'paused' | 'ended';

interface PageProps {
  searchParams: Promise<{
    q?: string;
    status?: Status | 'all';
  }>;
}

function fmtWon(n: number): string {
  return `₩${Math.round(n).toLocaleString()}`;
}

export default async function PreIssuedCodeMembersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const status = (params.status ?? 'active') as Status | 'all';

  const db = createAdminSupabaseClient();

  // 후보 영업자/리더 검색 대상:
  // - 조직도(active) 멤버 + 계정 발급된(user_profiles.member_id 존재) 멤버(계약/산하가 없어도 포함)
  const [membersRes, settingsRes, issuedProfilesRes, pendingProfilesRes, pendingSettingsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id,name,rank,phone,external_id,is_active')
      .order('name'),
    db
      .from('pre_issued_code_member_settings')
      .select(
        'id,member_id,parent_leader_member_id,reason,special_unit_price,special_unit_limit,effective_from,effective_to,status,note,updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(2000),
    db
      .from('user_profiles')
      .select('member_id, display_name, phone, role, is_active, mapping_status')
      .eq('role', 'member')
      .not('member_id', 'is', null)
      .limit(5000),
    db
      .from('user_profiles')
      .select('id, login_code, display_name, phone, mapping_status, pre_issued_name, pre_issued_phone, created_at')
      .eq('role', 'member')
      .is('member_id', null)
      .in('mapping_status', ['PENDING', 'MANUAL_REVIEW'])
      .order('created_at', { ascending: false })
      .limit(500),
    db
      .from('pre_issued_code_pending_settings')
      .select(
        'id,user_profile_id,desired_parent_leader_member_id,reason,special_unit_price,special_unit_limit,effective_from,effective_to,desired_status,note,promoted,promoted_at,promoted_member_id,promoted_setting_id,last_promotion_error,updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(2000),
  ]);

  if (membersRes.error) {
    return <div className="p-6 text-sm text-red-600">조직원 조회 실패: {membersRes.error.message}</div>;
  }
  if (settingsRes.error) {
    return <div className="p-6 text-sm text-red-600">설정 조회 실패: {settingsRes.error.message}</div>;
  }
  if (issuedProfilesRes.error) {
    return <div className="p-6 text-sm text-red-600">계정 발급 목록 조회 실패: {issuedProfilesRes.error.message}</div>;
  }
  if (pendingProfilesRes.error) {
    return <div className="p-6 text-sm text-red-600">미매핑 계정 조회 실패: {pendingProfilesRes.error.message}</div>;
  }
  if (pendingSettingsRes.error) {
    return <div className="p-6 text-sm text-red-600">예약 설정 조회 실패: {pendingSettingsRes.error.message}</div>;
  }

  const memberById = new Map<string, any>();
  for (const m of (membersRes.data ?? []) as any[]) memberById.set(String(m.id), m);

  // 계정 발급된 멤버가 is_active=false 등으로 조직도 후보에서 빠지지 않도록 합집합 처리
  const issuedMemberIdSet = new Set<string>();
  const issuedPhoneByMemberId = new Map<string, string | null>();
  const issuedDisplayByMemberId = new Map<string, string>();
  for (const p of (issuedProfilesRes.data ?? []) as any[]) {
    const mid = String(p.member_id ?? '').trim();
    if (!mid) continue;
    issuedMemberIdSet.add(mid);
    issuedPhoneByMemberId.set(mid, (p.phone ?? null) as string | null);
    issuedDisplayByMemberId.set(mid, String(p.display_name ?? '').trim());
  }

  const mergedMembers = (() => {
    const out: any[] = [];
    const added = new Set<string>();
    // 1) organization_members 전부
    for (const m of (membersRes.data ?? []) as any[]) {
      const id = String(m.id);
      if (added.has(id)) continue;
      added.add(id);
      out.push(m);
    }
    // 2) user_profiles에만 있고 membersRes에 누락된 경우(방어) — member_id FK라 보통은 존재함
    for (const id of issuedMemberIdSet) {
      if (added.has(id)) continue;
      out.push({
        id,
        name: issuedDisplayByMemberId.get(id) ?? id,
        rank: '영업사원',
        phone: issuedPhoneByMemberId.get(id) ?? null,
        external_id: null,
        is_active: true,
      });
      added.add(id);
    }
    return out;
  })();

  // UI 선택 후보: "계정 발급된 사람"은 무조건 포함 + (조직도 활성 멤버) 포함
  const selectableMembers = mergedMembers.filter((m: any) => {
    const id = String(m.id);
    const active = Boolean(m.is_active ?? true);
    return issuedMemberIdSet.has(id) || active;
  });

  const rows = ((settingsRes.data ?? []) as any[])
    .map((s) => {
      const m = memberById.get(String(s.member_id));
      const p = memberById.get(String(s.parent_leader_member_id));
      return {
        id: String(s.id),
        member_id: String(s.member_id),
        parent_leader_member_id: String(s.parent_leader_member_id),
        reason: String(s.reason ?? ''),
        special_unit_price: Number(s.special_unit_price ?? 100000),
        special_unit_limit: Number(s.special_unit_limit ?? 10),
        effective_from: String(s.effective_from ?? '').slice(0, 10),
        effective_to: s.effective_to != null ? String(s.effective_to).slice(0, 10) : null,
        status: String(s.status ?? 'active') as Status,
        note: (s.note ?? null) as string | null,
        member_name: m ? extractMemberName(String(m.name ?? '')).replace(/^\[고객\]\s*/, '') : String(s.member_id),
        member_rank: m?.rank ?? '-',
        parent_name: p ? extractMemberName(String(p.name ?? '')).replace(/^\[고객\]\s*/, '') : String(s.parent_leader_member_id),
        parent_rank: p?.rank ?? '-',
        member_phone: (m?.phone ?? null) as string | null,
      };
    })
    .filter((r) => (status === 'all' ? true : r.status === status))
    .filter((r) => {
      if (!q) return true;
      const hay = `${r.member_name} ${r.parent_name} ${r.reason}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });

  const spHref = (next: Partial<{ q: string; status: string }>) => {
    const sp = new URLSearchParams();
    const nq = next.q ?? q;
    const ns = next.status ?? status;
    if (nq) sp.set('q', nq);
    if (ns) sp.set('status', ns);
    return `/admin/sales/pre-issued-code-members?${sp.toString()}`;
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <div className="text-xs text-gray-500">관리자 · 조직/영업 관리</div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mt-2">코드 선발급자 관리</h2>
        <p className="text-xs text-gray-600 mt-2">
          코드 선발급자는 <span className="font-semibold">개인 직접판매 수당</span>에만 특례 단가가 적용되며,
          오버라이드·승급·보너스·더블업·썸머 페스티벌 규칙은 기존대로 유지됩니다.
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          className={[
            'rounded-full border px-3 py-1 text-xs font-semibold',
            status === 'active' ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-gray-200 bg-white text-gray-700',
          ].join(' ')}
          href={spHref({ status: 'active' })}
        >
          적용중
        </Link>
        <Link
          className={[
            'rounded-full border px-3 py-1 text-xs font-semibold',
            status === 'paused' ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-gray-200 bg-white text-gray-700',
          ].join(' ')}
          href={spHref({ status: 'paused' })}
        >
          중지
        </Link>
        <Link
          className={[
            'rounded-full border px-3 py-1 text-xs font-semibold',
            status === 'ended' ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-gray-200 bg-white text-gray-700',
          ].join(' ')}
          href={spHref({ status: 'ended' })}
        >
          종료
        </Link>
        <Link
          className={[
            'rounded-full border px-3 py-1 text-xs font-semibold',
            status === 'all' ? 'border-orange-300 bg-orange-50 text-orange-800' : 'border-gray-200 bg-white text-gray-700',
          ].join(' ')}
          href={spHref({ status: 'all' })}
        >
          전체
        </Link>
      </div>

      <PreIssuedCodeMembersClient
        members={selectableMembers as any[]}
        initialSettings={rows as any[]}
        pendingAccounts={(pendingProfilesRes.data ?? []) as any[]}
        pendingSettings={(pendingSettingsRes.data ?? []) as any[]}
      />

    </div>
  );
}

