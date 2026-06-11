'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type AdminItem = {
  id: string;
  applicant_user_id: string;
  applicant_member_id: string | null;
  applicant_name: string;
  name: string;
  birth_date: string;
  gender: string;
  phone: string;
  phone_digits: string;
  has_own_contract: boolean;
  memo: string | null;
  status: '신청중' | '시트등록완료' | '처리완료' | '반려' | string;
  requested_at: string;
  synced_to_sheet: boolean;
  sheet_synced_at: string | null;
  sheet_synced_by: string | null;
};

const STATUS_OPTIONS = ['신청중', '시트등록완료', '처리완료', '반려'] as const;

function fmtDateTime(iso: string | null): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}

function fmtBirth(b: string): string {
  const d = (b ?? '').replace(/\D/g, '');
  if (d.length !== 8) return b;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case '시트등록완료':
      return 'bg-blue-100 text-blue-700';
    case '처리완료':
      return 'bg-emerald-100 text-emerald-700';
    case '반려':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-amber-100 text-amber-700';
  }
}

export default function NewCodeClient() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [syncMessage, setSyncMessage] = useState<string>('');

  // 필터
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [applicant, setApplicant] = useState<string>('');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    '신청중',
    '시트등록완료',
    '처리완료',
    '반려',
  ]);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<boolean>(false);

  const load = useCallback(async () => {
    setError('');
    setSyncMessage('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (applicant.trim()) params.set('applicant', applicant.trim());
      if (selectedStatuses.length > 0 && selectedStatuses.length < STATUS_OPTIONS.length) {
        params.set('status', selectedStatuses.join(','));
      }
      const res = await fetch(`/api/admin/sales-code-requests?${params.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? '조회 실패');
        setItems([]);
        return;
      }
      setItems((json?.items ?? []) as AdminItem[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, applicant, selectedStatuses]);

  useEffect(() => {
    void load();
    // 최초 1회만 로드
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string, on: boolean) => {
    setChecked((prev) => ({ ...prev, [id]: on }));
  };

  const eligibleIds = useMemo(
    () => items.filter((i) => !i.synced_to_sheet).map((i) => i.id),
    [items],
  );
  const selectedCount = eligibleIds.filter((id) => checked[id]).length;

  const toggleAllEligible = (on: boolean) => {
    const next: Record<string, boolean> = { ...checked };
    for (const id of eligibleIds) next[id] = on;
    setChecked(next);
  };

  const sync = useCallback(async () => {
    setError('');
    setSyncMessage('');
    const ids = eligibleIds.filter((id) => checked[id]);
    if (ids.length === 0) {
      setError('동기화할 항목을 선택하세요.');
      return;
    }
    if (!confirm(`${ids.length}건을 구글 시트에 동기화합니다. 진행할까요?`)) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sales-code-requests/sync-sheet', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 207) {
        setError(json?.error ?? '동기화 실패');
        return;
      }
      const msg =
        `완료: 성공 ${json?.success_count ?? 0}건, 스킵(이미 동기화) ${json?.skipped_count ?? 0}건`;
      setSyncMessage(json?.error ? `${msg} · ${json.error}` : msg);
      await load();
      setChecked({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [eligibleIds, checked, load]);

  return (
    <>
      {/* 필터 */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-600">요청일 (from)</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-600">요청일 (to)</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-600">신청자 이름</label>
            <input
              value={applicant}
              onChange={(e) => setApplicant(e.target.value)}
              placeholder="부분 일치"
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-600">상태</label>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {STATUS_OPTIONS.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(s)}
                    onChange={(e) =>
                      setSelectedStatuses((prev) =>
                        e.target.checked ? [...new Set([...prev, s])] : prev.filter((x) => x !== s),
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded border px-3 py-1 text-xs hover:bg-slate-50"
          >
            {loading ? '조회 중…' : '조회'}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        {syncMessage && <p className="mt-2 text-xs text-emerald-700">{syncMessage}</p>}
      </section>

      {/* 액션 바 */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => toggleAllEligible(true)}
            className="rounded border px-2 py-0.5 hover:bg-slate-50"
          >
            동기화 가능 전체 선택
          </button>
          <button
            type="button"
            onClick={() => toggleAllEligible(false)}
            className="rounded border px-2 py-0.5 hover:bg-slate-50"
          >
            전체 해제
          </button>
          <span className="text-slate-500">선택됨 {selectedCount}건</span>
        </div>
        <button
          type="button"
          onClick={sync}
          disabled={syncing || selectedCount === 0}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {syncing ? '동기화 중…' : '선택 항목 구글 시트 동기화'}
        </button>
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2"> </th>
              <th className="px-2 py-2 text-left font-medium">요청일자</th>
              <th className="px-2 py-2 text-left font-medium">신청자</th>
              <th className="px-2 py-2 text-left font-medium">신청자 ID</th>
              <th className="px-2 py-2 text-left font-medium">이름</th>
              <th className="px-2 py-2 text-left font-medium">생년월일</th>
              <th className="px-2 py-2 text-left font-medium">성별</th>
              <th className="px-2 py-2 text-left font-medium">전화번호</th>
              <th className="px-2 py-2 text-left font-medium">본인 가입구좌</th>
              <th className="px-2 py-2 text-left font-medium">사유 메모</th>
              <th className="px-2 py-2 text-left font-medium">상태</th>
              <th className="px-2 py-2 text-left font-medium">시트 동기화</th>
              <th className="px-2 py-2 text-left font-medium">동기화 일시</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-6 text-center text-slate-400">
                  조회된 신청 내역이 없습니다.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr
                  key={it.id}
                  className={`border-t border-slate-100 ${
                    it.synced_to_sheet ? 'bg-slate-50/60 text-slate-500' : ''
                  }`}
                >
                  <td className="px-2 py-2 align-top">
                    <input
                      type="checkbox"
                      disabled={it.synced_to_sheet}
                      checked={!!checked[it.id]}
                      onChange={(e) => toggle(it.id, e.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-2 align-top tabular-nums">{fmtDateTime(it.requested_at)}</td>
                  <td className="px-2 py-2 align-top">{it.applicant_name}</td>
                  <td className="px-2 py-2 align-top font-mono text-[10px] text-slate-400">
                    {it.applicant_user_id.slice(0, 8)}…
                  </td>
                  <td className="px-2 py-2 align-top font-medium text-slate-900">{it.name}</td>
                  <td className="px-2 py-2 align-top tabular-nums">{fmtBirth(it.birth_date)}</td>
                  <td className="px-2 py-2 align-top">{it.gender}</td>
                  <td className="px-2 py-2 align-top tabular-nums">{it.phone}</td>
                  <td className="px-2 py-2 align-top">{it.has_own_contract ? '예' : '아니오'}</td>
                  <td className="px-2 py-2 align-top">
                    {it.memo ? (
                      <span className="block max-w-[14rem] truncate" title={it.memo}>
                        {it.memo}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(
                        it.status,
                      )}`}
                    >
                      {it.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 align-top">
                    {it.synced_to_sheet ? (
                      <span className="text-emerald-700">완료</span>
                    ) : (
                      <span className="text-slate-400">미완료</span>
                    )}
                  </td>
                  <td className="px-2 py-2 align-top tabular-nums">{fmtDateTime(it.sheet_synced_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
