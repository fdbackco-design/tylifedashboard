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
  employee_id: string | null;
  issuance_status: 'WAITING' | 'EXPORTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SYNC_FAILED';
  excel_downloaded_at: string | null;
  processing_started_at: string | null;
  completed_at: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  sheet_row_number: number | null;
  sheet_written_at: string | null;
  account_synced_at: string | null;
  issuance_error: string | null;
  retry_count: number;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  rejected_by?: string | null;
};

const STATUS_OPTIONS = ['신청중', '시트등록완료', '처리완료', '반려'] as const;

type IssuanceResultItem = {
  id: string;
  name: string;
  result: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  stage: string;
  reason?: string;
  employeeId?: string;
  sheetRow?: number;
};

function issuanceStatusLabel(status: AdminItem['issuance_status']): string {
  switch (status) {
    case 'EXPORTED': return '엑셀 다운로드 완료';
    case 'PROCESSING': return '발급 처리 중';
    case 'COMPLETED': return '발급완료';
    case 'FAILED': return '발급실패';
    case 'SYNC_FAILED': return '동기화 실패';
    case 'WAITING':
    default: return '발급대기';
  }
}

function issuanceStatusClass(status: AdminItem['issuance_status']): string {
  switch (status) {
    case 'COMPLETED': return 'bg-emerald-100 text-emerald-700';
    case 'PROCESSING': return 'bg-blue-100 text-blue-700';
    case 'FAILED':
    case 'SYNC_FAILED': return 'bg-red-100 text-red-700';
    case 'EXPORTED': return 'bg-violet-100 text-violet-700';
    default: return 'bg-amber-100 text-amber-700';
  }
}

function isStaleProcessing(item: AdminItem): boolean {
  if (item.issuance_status !== 'PROCESSING' || !item.processing_started_at) return false;
  const startedAt = new Date(item.processing_started_at).getTime();
  return Number.isFinite(startedAt) && startedAt < Date.now() - 10 * 60 * 1000;
}

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
  const [exporting, setExporting] = useState<boolean>(false);
  const [issuanceResults, setIssuanceResults] = useState<IssuanceResultItem[]>([]);

  // 반려 모달
  const [rejectTarget, setRejectTarget] = useState<AdminItem | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [rejecting, setRejecting] = useState<boolean>(false);
  const [rejectError, setRejectError] = useState<string>('');

  // 반려 취소
  const [unrejectingId, setUnrejectingId] = useState<string | null>(null);

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
    () => items
      .filter(
        (i) =>
          i.status !== '반려' &&
          i.status !== '처리완료' &&
          (i.issuance_status !== 'PROCESSING' || isStaleProcessing(i)) &&
          i.issuance_status !== 'COMPLETED',
      )
      .map((i) => i.id),
    [items],
  );
  const selectedCount = eligibleIds.filter((id) => checked[id]).length;

  const toggleAllEligible = (on: boolean) => {
    if (!on) {
      const next: Record<string, boolean> = { ...checked };
      for (const id of eligibleIds) next[id] = false;
      setChecked(next);
      return;
    }
    // 발급 가능/재시도 가능 대상만 선택한다.
    const next: Record<string, boolean> = { ...checked };
    for (const it of items) {
      next[it.id] = eligibleIds.includes(it.id);
    }
    setChecked(next);
  };

  const downloadExcel = useCallback(async () => {
    setError('');
    setSyncMessage('');
    setIssuanceResults([]);
    const ids = eligibleIds.filter((id) => checked[id]);
    if (ids.length === 0) return setError('다운로드할 항목을 선택하세요.');
    setExporting(true);
    try {
      const res = await fetch('/api/admin/sales-code-requests/export', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const details = [...(json?.invalid ?? []), ...(json?.unavailable ?? [])]
          .map((item: { name?: string; reason?: string }) =>
            `${item.name ?? '대상'}${item.reason ? `: ${item.reason}` : ''}`)
          .join(', ');
        setError(`${json?.error ?? '엑셀 다운로드 실패'}${details ? ` · ${details}` : ''}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'sales_code.xlsx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSyncMessage(`선택한 ${ids.length}명의 엑셀 다운로드를 완료했습니다.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [eligibleIds, checked, load]);

  const sync = useCallback(async () => {
    setError('');
    setSyncMessage('');
    const ids = eligibleIds.filter((id) => checked[id]);
    if (ids.length === 0) {
      setError('동기화할 항목을 선택하세요.');
      return;
    }
    if (!confirm(`${ids.length}건의 발급완료 처리를 시작합니다. 진행할까요?`)) return;
    setSyncing(true);
    setIssuanceResults([]);
    try {
      const res = await fetch('/api/admin/sales-code-requests/sync-sheet', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.message || json?.error || `발급 처리 실패 (HTTP ${res.status})`);
        await load();
        return;
      }
      setIssuanceResults(Array.isArray(json?.results) ? json.results : []);
      const msg = `발급 완료 ${json?.success_count ?? 0}명 · 실패 ${json?.failed_count ?? 0}명 · 제외 ${json?.skipped_count ?? 0}명`;
      if ((json?.failed_count ?? 0) > 0) setError(msg);
      else setSyncMessage(msg);
      await load();
      setChecked({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [eligibleIds, checked, load]);

  const retryOne = useCallback(async (id: string) => {
    setError('');
    setSyncMessage('');
    setIssuanceResults([]);
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sales-code-requests/sync-sheet', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.message || json?.error || `재시도 실패 (HTTP ${res.status})`);
        return;
      }
      setIssuanceResults(Array.isArray(json?.results) ? json.results : []);
      if ((json?.failed_count ?? 0) > 0) {
        setError(`재시도 실패 ${json.failed_count}명`);
      } else {
        setSyncMessage('재시도가 완료되었습니다.');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [load]);

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
      await load();
      setRejectTarget(null);
      setRejectReason('');
    } catch (e) {
      setRejectError((e as Error).message);
    } finally {
      setRejecting(false);
    }
  }, [rejectTarget, rejectReason, load]);

  const submitUnreject = useCallback(
    async (it: AdminItem) => {
      if (unrejectingId) return;
      const ok = window.confirm(
        `${it.name} (${it.phone}) 신청의 반려를 취소하고 다시 처리 가능한 상태로 되돌릴까요?`,
      );
      if (!ok) return;
      setUnrejectingId(it.id);
      setError('');
      setSyncMessage('');
      try {
        const res = await fetch(`/api/admin/sales-code-requests/${it.id}/unreject`, {
          method: 'POST',
          credentials: 'include',
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error ?? '반려 취소 실패');
          return;
        }
        const updated = json?.item as AdminItem | undefined;
        if (updated) {
          setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
          setSyncMessage(`반려 취소 완료 → ${updated.status}`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUnrejectingId(null);
      }
    },
    [unrejectingId, load],
  );

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
        {issuanceResults.length > 0 && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
            <p className="font-semibold text-slate-700">대상별 처리 결과</p>
            <ul className="mt-1 space-y-1">
              {issuanceResults.map((result) => (
                <li
                  key={result.id}
                  className={result.result === 'SUCCESS' ? 'text-emerald-700' : result.result === 'FAILED' ? 'text-red-700' : 'text-slate-600'}
                >
                  {result.name || result.id}: {result.result === 'SUCCESS' ? '발급완료' : result.result === 'FAILED' ? '실패' : '제외'}
                  {result.reason ? ` - ${result.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 액션 바 */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => toggleAllEligible(true)}
            className="rounded border px-2 py-0.5 hover:bg-slate-50"
          >
            발급 가능 전체 선택
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadExcel}
            disabled={syncing || exporting || selectedCount === 0}
            className="rounded border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-60"
          >
            {exporting ? '엑셀 생성 중…' : '선택 항목 엑셀 다운로드'}
          </button>
          <button
            type="button"
            onClick={sync}
            disabled={syncing || exporting || selectedCount === 0}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
          >
            {syncing ? '발급 처리 중…' : '발급완료'}
          </button>
        </div>
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1320px] text-xs sm:text-sm">
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
            <col className="w-[8.5rem]" />
            <col className="w-[8.5rem]" />
            <col className="w-[13rem]" />
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
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">발급 상태</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">사원ID</th>
              <th className="whitespace-nowrap px-2 py-2 text-left font-medium">발급 상세</th>
              <th className="whitespace-nowrap px-2 py-2 text-right font-medium">동작</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-3 py-6 text-center text-slate-400">
                  조회된 신청 내역이 없습니다.
                </td>
              </tr>
            ) : (
              items.map((it) => {
                const isRejected = it.status === '반려';
                const canReject =
                  !isRejected &&
                  it.issuance_status !== 'PROCESSING' &&
                  it.issuance_status !== 'COMPLETED';
                const eligible = eligibleIds.includes(it.id);
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
                          disabled={!eligible || syncing || exporting}
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
                          <span className="block max-w-[18rem] whitespace-pre-wrap break-words text-slate-800 sm:max-w-[32rem] line-clamp-4">
                            {it.memo}
                          </span>
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
                      <td className="whitespace-nowrap px-2 py-2 align-top">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${issuanceStatusClass(it.issuance_status)}`}>
                          {issuanceStatusLabel(it.issuance_status)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top font-mono text-[11px]">
                        {it.employee_id ?? '-'}
                      </td>
                      <td className="px-2 py-2 align-top text-[11px]">
                        <div>완료: {fmtDateTime(it.completed_at)}</div>
                        <div>처리자: {it.processed_by_name ?? '-'}</div>
                        <div>
                          시트: {it.sheet_written_at ? `${it.sheet_row_number ?? '-'}행 기록` : '미기록'} ·
                          계정: {it.account_synced_at ? '동기화' : '미동기화'}
                        </div>
                        {it.issuance_error && <div className="mt-0.5 text-red-600">{it.issuance_error}</div>}
                        {it.retry_count > 0 && <div className="text-slate-500">재시도 {it.retry_count}회</div>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top text-right">
                        {isRejected ? (
                          <button
                            type="button"
                            onClick={() => void submitUnreject(it)}
                            disabled={unrejectingId === it.id || syncing || exporting}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {unrejectingId === it.id ? '취소 중…' : '반려 취소'}
                          </button>
                        ) : it.issuance_status === 'SYNC_FAILED' || isStaleProcessing(it) ? (
                          <button
                            type="button"
                            onClick={() => void retryOne(it.id)}
                            disabled={syncing || exporting}
                            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                          >
                            재시도
                          </button>
                        ) : canReject && it.issuance_status !== 'COMPLETED' ? (
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
                        <td colSpan={16} className="px-3 py-2 align-top">
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
