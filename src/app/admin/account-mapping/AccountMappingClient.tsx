'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface NoProfileRow {
  memberId: string;
  name: string;
  rank: string;
  phone: string;
  externalId: string;
  sourceCustomerId: string;
  settlementYearMonth: string;
  settlementTotal: number;
}

export interface BrokenProfileRow {
  profileId: string;
  profileLoginCode: string;
  profileDisplayName: string;
  legacyMemberId: string;
  legacyMemberName: string;
  activeMemberId: string;
  activeMemberName: string;
  activeMemberRank: string;
  activeMemberPhone: string;
  activeMemberSourceCustomerId: string;
}

export interface DuplicatePhoneRow {
  phoneDigits: string;
  members: Array<{
    memberId: string;
    name: string;
    rank: string;
    externalId: string;
    sourceCustomerId: string;
    createdAt: string;
  }>;
}

export interface LegacyPrefixRow {
  memberId: string;
  name: string;
  rank: string;
  phone: string;
  externalId: string;
  sourceCustomerId: string;
}

interface Props {
  noProfileButHasSettlement: NoProfileRow[];
  profilePointsToLegacyMember: BrokenProfileRow[];
  duplicateActivePhones: DuplicatePhoneRow[];
  legacyPrefixActiveMembers: LegacyPrefixRow[];
}

function fmtWon(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}

export default function AccountMappingClient({
  noProfileButHasSettlement,
  profilePointsToLegacyMember,
  duplicateActivePhones,
  legacyPrefixActiveMembers,
}: Props) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onRepairProfile(profileId: string, newMemberId: string) {
    setError(null);
    setDone(null);
    setBusyKey(`profile:${profileId}`);
    try {
      const res = await fetch('/api/admin/account-mapping/repair', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, newMemberId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(String(json?.message ?? '복구 실패'));
        return;
      }
      setDone('계정 매핑이 복구되었습니다.');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function onDeactivateLegacyMember(memberId: string) {
    if (!confirm('이 노드를 비활성화할까요? (참조가 모두 0건일 때만 실제로 비활성화됩니다)')) return;
    setError(null);
    setDone(null);
    setBusyKey(`deactivate:${memberId}`);
    try {
      const res = await fetch('/api/admin/account-mapping/repair', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deactivateLegacyMemberId: memberId }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(String(json?.message ?? '비활성화 실패'));
        return;
      }
      setDone(
        json?.deactivated
          ? '옛 노드가 비활성화되었습니다.'
          : `안전 조건이 충족되지 않아 비활성화하지 않았습니다. (참조: ${JSON.stringify(json?.references ?? {})})`,
      );
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div>
      {error ? (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
          {error}
        </div>
      ) : null}
      {done ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
          {done}
        </div>
      ) : null}

      {/* (1) user_profiles 가 옛 노드 가리키는 영업자 — 자동 복구 가능 */}
      <Section
        title="① user_profiles 가 옛/비활성 노드를 가리키는 영업자"
        subtitle="현재 정산용 활성 멤버로 자동 재매핑할 수 있는 케이스입니다."
        count={profilePointsToLegacyMember.length}
      >
        {profilePointsToLegacyMember.length === 0 ? (
          <Empty />
        ) : (
          <table className="min-w-[1000px] w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">로그인 코드</th>
                <th className="px-3 py-2 font-medium">표시명</th>
                <th className="px-3 py-2 font-medium">옛 멤버</th>
                <th className="px-3 py-2 font-medium">→ 활성 멤버</th>
                <th className="px-3 py-2 font-medium">전화번호</th>
                <th className="px-3 py-2 text-center font-medium">동작</th>
              </tr>
            </thead>
            <tbody>
              {profilePointsToLegacyMember.map((r) => (
                <tr key={r.profileId} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{r.profileLoginCode || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.profileDisplayName || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{r.legacyMemberName}</div>
                    <div className="font-mono text-[10px] text-slate-400">{r.legacyMemberId}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-emerald-700">{r.activeMemberName}</div>
                    <div className="text-[10px] text-slate-500">{r.activeMemberRank}</div>
                    <div className="font-mono text-[10px] text-slate-400">{r.activeMemberId}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.activeMemberPhone || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onRepairProfile(r.profileId, r.activeMemberId)}
                      disabled={busyKey === `profile:${r.profileId}`}
                      className="inline-flex items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {busyKey === `profile:${r.profileId}` ? '복구 중…' : '계정 매핑 복구'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* (2) 정산 데이터 있는데 user_profiles 없는 영업자 */}
      <Section
        title="② 정산 데이터가 있는데 user_profiles 가 없는 영업자"
        subtitle="이 영업자들은 /admin/account-issue 에서 로그인 계정(영업자 코드)을 발급해야 명세서 링크가 만들어집니다."
        count={noProfileButHasSettlement.length}
      >
        {noProfileButHasSettlement.length === 0 ? (
          <Empty />
        ) : (
          <table className="min-w-[1000px] w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">영업자</th>
                <th className="px-3 py-2 font-medium">직책</th>
                <th className="px-3 py-2 font-medium">전화번호</th>
                <th className="px-3 py-2 font-medium">최근 정산월</th>
                <th className="px-3 py-2 text-right font-medium">정산액</th>
                <th className="px-3 py-2 font-medium">customer_id</th>
              </tr>
            </thead>
            <tbody>
              {noProfileButHasSettlement.map((r) => (
                <tr key={r.memberId} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {r.name}
                    <div className="font-mono text-[10px] text-slate-400">{r.memberId}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.rank}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.phone || '—'}</td>
                  <td className="px-3 py-2 text-slate-700">{r.settlementYearMonth || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">{fmtWon(r.settlementTotal)}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{r.sourceCustomerId || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* (3) 동일 phone 중복 active 멤버 */}
      <Section
        title="③ 동일 phone 을 가진 active 영업자 중복 후보"
        subtitle="같은 사람이 별도 노드로 만들어졌을 가능성이 있습니다. 수동 검토 후 한 쪽을 비활성화하세요."
        count={duplicateActivePhones.length}
      >
        {duplicateActivePhones.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-3">
            {duplicateActivePhones.map((g) => (
              <div key={g.phoneDigits} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <div className="mb-2 text-[11px] font-semibold text-amber-900">
                  phone digits = <span className="font-mono">{g.phoneDigits}</span>
                </div>
                <table className="w-full text-xs">
                  <thead className="text-slate-600">
                    <tr className="text-left">
                      <th className="px-2 py-1 font-medium">영업자</th>
                      <th className="px-2 py-1 font-medium">직책</th>
                      <th className="px-2 py-1 font-medium">external_id</th>
                      <th className="px-2 py-1 font-medium">source_customer_id</th>
                      <th className="px-2 py-1 font-medium">생성일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.members.map((m) => (
                      <tr key={m.memberId} className="border-t border-amber-200/60">
                        <td className="px-2 py-1">
                          <div className="font-medium text-slate-900">{m.name}</div>
                          <div className="font-mono text-[10px] text-slate-500">{m.memberId}</div>
                        </td>
                        <td className="px-2 py-1 text-slate-700">{m.rank}</td>
                        <td className="px-2 py-1 font-mono text-[10px] text-slate-500">{m.externalId || '—'}</td>
                        <td className="px-2 py-1 font-mono text-[10px] text-slate-500">{m.sourceCustomerId || '—'}</td>
                        <td className="px-2 py-1 text-[11px] text-slate-500">
                          {new Date(m.createdAt).toISOString().slice(0, 10)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* (4) [고객] prefix 남은 active 멤버 */}
      <Section
        title="④ [고객] prefix 가 남아 있는 활성 영업자 노드"
        subtitle="옛 임시 노드일 가능성이 큽니다. 안전 조건 충족 시 비활성화할 수 있습니다."
        count={legacyPrefixActiveMembers.length}
      >
        {legacyPrefixActiveMembers.length === 0 ? (
          <Empty />
        ) : (
          <table className="min-w-[900px] w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">이름</th>
                <th className="px-3 py-2 font-medium">직책</th>
                <th className="px-3 py-2 font-medium">전화번호</th>
                <th className="px-3 py-2 font-medium">external_id</th>
                <th className="px-3 py-2 font-medium">source_customer_id</th>
                <th className="px-3 py-2 text-center font-medium">동작</th>
              </tr>
            </thead>
            <tbody>
              {legacyPrefixActiveMembers.map((m) => (
                <tr key={m.memberId} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {m.name}
                    <div className="font-mono text-[10px] text-slate-400">{m.memberId}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{m.rank}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{m.phone || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{m.externalId || '—'}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{m.sourceCustomerId || '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => onDeactivateLegacyMember(m.memberId)}
                      disabled={busyKey === `deactivate:${m.memberId}`}
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busyKey === `deactivate:${m.memberId}` ? '처리 중…' : '비활성화 시도'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-slate-200">
      <header className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
        <div className="text-[11px] font-semibold text-slate-700">
          <span className="mr-1">건수</span>
          <span className={count === 0 ? 'text-emerald-700' : 'text-rose-700'}>{count.toLocaleString('ko-KR')}</span>
        </div>
      </header>
      <div className="overflow-auto p-2">{children}</div>
    </section>
  );
}

function Empty() {
  return (
    <div className="px-3 py-4 text-center text-[12px] text-slate-500">어긋난 데이터가 없습니다.</div>
  );
}
