'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

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
  rejection_reason?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
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

  // 반려 모달
  const [rejectTarget, setRejectTarget] = useState<AdminItem | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejecting, setRejecting] = useState<boolean>(false);
  const [rejectError, setRejectError] = useState<string>('');

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
      // `/admin/newcode?debug=1` 로 진입한 경우 server 라우트에도 ?debug=1 을 전달해
      // 정상 흐름 로그까지 출력하도록 한다.
      const debugQs =
        typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('debug') === '1'
          ? '?debug=1'
          : '';
      const res = await fetch(`/api/admin/sales-code-requests/sync-sheet${debugQs}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json().catch(() => ({}));

      // 시트 write 가 실패했거나 갱신 셀이 0 인 경우 (502 등): DB 상태는 그대로,
      // 화면에도 실패 메시지만 표시한다 (성공으로 보이지 않게).
      if (!res.ok && res.status !== 207) {
        const errMsg =
          json?.message || json?.error || `동기화 실패 (HTTP ${res.status})`;
        const failedCount = Array.isArray(json?.failedRequestIds)
          ? json.failedRequestIds.length
          : ids.length;
        setError(`${errMsg} · 실패 ${failedCount}건 (DB 상태 유지)`);
        await load();
        return;
      }

      // 부분 성공: 시트는 성공했지만 DB 마킹이 실패한 케이스.
      // → 사용자에게 실패임을 명확히 알리고 syncMessage 에 시트 갱신 사실만 보조 안내한다.
      if (res.status === 207) {
        const errMsg = json?.message || json?.error || 'DB 마킹 실패';
        const failedCount = Array.isArray(json?.failedRequestIds)
          ? json.failedRequestIds.length
          : ids.length;
        setError(`${errMsg} · 실패 ${failedCount}건 (시트는 기록됨)`);
        await load();
        return;
      }

      // 완전 성공 분기: 응답에 ok:true 가 명시되어야 한다.
      if (json?.ok !== true) {
        setError(json?.message || json?.error || '동기화 실패: 응답 형식 오류');
        await load();
        return;
      }
      const updatedCells = json?.updated?.updatedCells ?? 0;
      const updatedRows = json?.updated?.updatedRows ?? 0;
      const updatedRange = json?.updated?.updatedRange ?? '';
      const msg =
        `완료: 성공 ${json?.success_count ?? 0}건, 스킵(이미 동기화) ${json?.skipped_count ?? 0}건` +
        (updatedRows
          ? ` · 시트 갱신 ${updatedRows}행/${updatedCells}셀${updatedRange ? ` (${updatedRange})` : ''}`
          : '');
      setSyncMessage(msg);
      await load();
      setChecked({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [eligibleIds, checked, load]);

  const openReject = (it: AdminItem) => {
    setRejectError('');
    setRejectReason('');
    setRejectTarget(it);
  };
  const closeReject = () => {
    if (rejecting) return;
    setRejectTarget(null);
    setRejectReason('');
    setRejectError('');
  };
  const submitReject = useCallback(async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('반려 사유를 입력하세요.');
      return;
    }
    setRejecting(true);
    setRejectError('');
    try {
      const res = await fetch(
        `/api/admin/sales-code-requests/${rejectTarget.id}/reject`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRejectError(json?.error ?? '반려 실패');
        return;
      }
      const updated = json?.item as AdminItem | undefined;
      if (updated) {
        setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      }
      setRejectTarget(null);
      setRejectReason('');
    } catch (e) {
      setRejectError((e as Error).message);
    } finally {
      setRejecting(false);
    }
  }, [rejectTarget, rejectReason]);

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
        <table className="w-full table-fixed text-xs sm:text-sm">
          <colgroup>
            <col className="w-9" />
            <col className="w-[8.5rem]" />
            <col className="w-[5.5rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[6.5rem]" />
            <col className="w-10" />
            <col className="w-[7.5rem]" />
            <col className="w-[5.5rem]" />
            <col />
            <col className="w-[6.5rem]" />
            <col className="w-[5.5rem]" />
            <col className="w-[8.5rem]" />
            <col className="w-14" />
          </colgroup>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="whitespace-nowrap px-2 py-2"> </th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">요청일자</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">신청자</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">이름</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">생년월일</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">성별</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">전화번호</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">본인 가입구좌</th>
              <th className="px-2 py-2 text-left font-medium">사유 메모</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">상태</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">시트 동기화</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">동기화 일시</th>
              <th className="whitespace-nowrap px-2 py-2 text-right font-medium">동작</th>
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
              items.map((it) => {
                const isRejected = it.status === '반려';
                const canReject = !isRejected;
                return (
                  <Fragment key={it.id}>
                    <tr
                      className={`border-t border-slate-100 ${
                        isRejected
                          ? 'bg-red-50/60'
                          : it.synced_to_sheet
                          ? 'bg-slate-50/60 text-slate-500'
                          : ''
                      }`}
                    >
                      <td className="whitespace-nowrap px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          disabled={it.synced_to_sheet}
                          checked={!!checked[it.id]}
                          onChange={(e) => toggle(it.id, e.target.checked)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top tabular-nums">{fmtDateTime(it.requested_at)}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top">{it.applicant_name}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top font-medium text-slate-900">{it.name}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top tabular-nums">{fmtBirth(it.birth_date)}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top">{it.gender}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top tabular-nums">{it.phone}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top">{it.has_own_contract ? '예' : '아니오'}</td>
                      <td className="px-2 py-2 align-top">
                        {it.memo ? (
                          <span className="block whitespace-pre-wrap break-words text-slate-800">{it.memo}</span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(
                            it.status,
                          )}`}
                        >
                          {it.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top">
                        {it.synced_to_sheet ? (
                          <span className="text-emerald-700">완료</span>
                        ) : (
                          <span className="text-slate-400">미완료</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top tabular-nums">{fmtDateTime(it.sheet_synced_at)}</td>
                      <td className="whitespace-nowrap px-2 py-2 align-top text-right">
                        {canReject ? (
                          <button
                            type="button"
                            onClick={() => openReject(it)}
                            className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                          >
                            반려
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-300">-</span>
                        )}
                      </td>
                    </tr>
                    {isRejected && (it.rejection_reason ?? '').trim() !== '' && (
                      <tr className="border-t border-red-100 bg-red-50/60">
                        <td colSpan={13} className="px-3 py-2 align-top">
                          <div className="flex flex-col gap-1 text-[12px] text-red-700 sm:flex-row sm:items-start sm:gap-2">
                            <span className="inline-flex shrink-0 items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                              반려 사유
                            </span>
                            <span className="whitespace-pre-wrap break-words">{it.rejection_reason}</span>
                            {it.rejected_at && (
                              <span className="ml-auto shrink-0 text-[11px] text-red-500 tabular-nums">
                                {fmtDateTime(it.rejected_at)}
                                {it.rejected_by ? ` · ${it.rejected_by}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {/* 반려 모달 */}
      {rejectTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={closeReject}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900">신청 반려</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              아래 신청을 반려합니다. 입력한 사유는 신청자(영업자) 화면에 그대로 표시됩니다.
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="grid grid-cols-1 gap-y-0.5 sm:grid-cols-2 sm:gap-x-3">
                <div>
                  <span className="text-slate-500">신청자</span>{' '}
                  <span className="font-medium text-slate-900">{rejectTarget.applicant_name}</span>
                </div>
                <div>
                  <span className="text-slate-500">신청 대상</span>{' '}
                  <span className="font-medium text-slate-900">{rejectTarget.name}</span>
                </div>
                <div className="tabular-nums">
                  <span className="text-slate-500">생년월일</span> {fmtBirth(rejectTarget.birth_date)}
                </div>
                <div className="tabular-nums">
                  <span className="text-slate-500">전화</span> {rejectTarget.phone}
                </div>
              </div>
            </div>
            <label className="mt-3 block text-xs font-medium text-slate-700">반려 사유 *</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="예) 동명이인 / 정보 불일치 / 추가 자료 필요 등"
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              disabled={rejecting}
              lang="ko"
              inputMode="text"
              autoComplete="off"
              autoFocus
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
              <span>최대 1000자</span>
              <span className="tabular-nums">{rejectReason.length} / 1000</span>
            </div>
            {rejectError && <p className="mt-2 text-xs text-red-600">{rejectError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeReject}
                disabled={rejecting}
                className="rounded border px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitReject}
                disabled={rejecting || !rejectReason.trim()}
                className="rounded bg-red-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              >
                {rejecting ? '반려 중…' : '반려 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
