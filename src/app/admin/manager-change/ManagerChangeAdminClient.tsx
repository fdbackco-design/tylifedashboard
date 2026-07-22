'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtDateTimeSeoul, formatManagerChangeCodesLine, managerChangeStatusLabel } from '@/lib/manager-change/format';

type AdminItem = {
  id: string;
  requester_name: string;
  requester_phone: string | null;
  customer_name: string;
  resident_number: string;
  customer_phone: string | null;
  account_count: number;
  contract_codes: string;
  item_name: string;
  branch_name: string;
  before_manager_name: string;
  before_manager_phone: string | null;
  after_manager_name: string;
  after_manager_phone: string;
  status: 'PENDING' | 'RECEIVED' | 'COMPLETED' | 'REJECTED' | string;
  created_at: string;
  completed_at: string | null;
  rejection_reason: string | null;
  rejected_at: string | null;
  rejected_by_admin_id: string | null;
};

type StatusFilter = 'ALL' | 'PENDING' | 'RECEIVED' | 'COMPLETED' | 'REJECTED';

function statusBadgeClass(status: string): string {
  if (status === 'COMPLETED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'REJECTED') return 'bg-red-100 text-red-700';
  if (status === 'RECEIVED') return 'bg-sky-100 text-sky-700';
  return 'bg-amber-100 text-amber-700';
}

function DetailCard({ item }: { item: AdminItem }) {
  const codesLine = formatManagerChangeCodesLine(item.contract_codes, item.item_name);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <p className="mb-3 text-base font-bold text-slate-900">[영업 담당자 변경]</p>
      <dl className="space-y-3">
        <div>
          <dt className="text-xs font-medium text-slate-500">-고객명</dt>
          <dd className="mt-0.5 font-medium text-slate-900">{item.customer_name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-주민번호</dt>
          <dd className="mt-0.5 text-slate-900">{item.resident_number}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-연락처</dt>
          <dd className="mt-0.5 text-slate-900">{item.customer_phone ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-가입구좌</dt>
          <dd className="mt-0.5 text-slate-900">{item.account_count}구좌</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-회원 코드 및 제품명</dt>
          <dd className="mt-0.5 break-words text-slate-900">{codesLine}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-소속 지사명</dt>
          <dd className="mt-0.5 text-slate-900">{item.branch_name}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-변경 전 담당자명 / 연락처</dt>
          <dd className="mt-0.5 text-slate-900">
            <span className="flex flex-col gap-0.5 sm:flex-row sm:gap-1">
              <span className="font-medium">{item.before_manager_name}</span>
              <span className="text-slate-400 hidden sm:inline">/</span>
              <span className="tabular-nums">{item.before_manager_phone ?? '-'}</span>
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-변경 후 담당자명 / 연락처</dt>
          <dd className="mt-0.5 font-medium text-orange-700">
            <span className="flex flex-col gap-0.5 sm:flex-row sm:gap-1">
              <span className="font-semibold">{item.after_manager_name}</span>
              <span className="text-orange-300 hidden sm:inline">/</span>
              <span className="tabular-nums">{item.after_manager_phone}</span>
            </span>
          </dd>
        </div>
      </dl>
      {item.status === 'REJECTED' && (item.rejection_reason ?? '').trim() !== '' ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-semibold">반려 사유</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{item.rejection_reason}</p>
          {item.rejected_at ? (
            <p className="mt-1 text-red-500">{fmtDateTimeSeoul(item.rejected_at)}</p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        신청자: {item.requester_name}
        {item.requester_phone ? ` (${item.requester_phone})` : ''}
        {' · '}
        신청일 {fmtDateTimeSeoul(item.created_at)}
        {item.completed_at ? ` · 완료일 ${fmtDateTimeSeoul(item.completed_at)}` : ''}
      </p>
    </div>
  );
}

export default function ManagerChangeAdminClient() {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [completing, setCompleting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/manager-change-requests?${params.toString()}`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '조회 실패');
      const list = (json?.items ?? []) as AdminItem[];
      setItems(list);
      setChecked({});
      setSelectedId((prev) => {
        if (list.length === 0) return null;
        if (prev && list.some((i) => i.id === prev)) return prev;
        return list[0].id;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingIds = useMemo(() => items.filter((i) => i.status === 'PENDING').map((i) => i.id), [items]);
  const selectedPendingCount = pendingIds.filter((id) => checked[id]).length;
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  const toggleAllPending = (on: boolean) => {
    const next = { ...checked };
    for (const id of pendingIds) next[id] = on;
    setChecked(next);
  };

  async function receiveSelected() {
    const ids = pendingIds.filter((id) => checked[id]);
    if (ids.length === 0) {
      setError('접수완료 처리할 신청중 항목을 선택하세요.');
      return;
    }
    setCompleting(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/manager-change-requests/receive', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '접수완료 처리 실패');
      setMessage(`${(json?.receivedIds ?? []).length}건 접수완료 처리했습니다.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompleting(false);
    }
  }

  async function receiveOne(id: string) {
    setCompleting(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/manager-change-requests/receive', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '접수완료 처리 실패');
      setMessage('접수완료 처리했습니다.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompleting(false);
    }
  }

  function openReject(item: AdminItem) {
    setRejectError('');
    setRejectReason('');
    setRejectTarget(item);
  }

  function closeReject() {
    if (rejecting) return;
    setRejectTarget(null);
    setRejectReason('');
    setRejectError('');
  }

  async function submitReject() {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('반려 사유를 입력하세요.');
      return;
    }
    setRejecting(true);
    setRejectError('');
    try {
      const res = await fetch('/api/admin/manager-change-requests/reject', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: rejectTarget.id, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRejectError(json?.error ?? '반려 실패');
        return;
      }
      setRejectTarget(null);
      setRejectReason('');
      setMessage('반려 처리했습니다.');
      await load();
    } catch (e) {
      setRejectError(e instanceof Error ? e.message : String(e));
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'PENDING', 'RECEIVED', 'COMPLETED', 'REJECTED'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
              statusFilter === s
                ? 'border-orange-300 bg-orange-50 text-orange-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {s === 'ALL' ? '전체' : managerChangeStatusLabel(s)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          새로고침
        </button>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-900">신청 목록</span>
            {pendingIds.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => toggleAllPending(true)}
                  className="text-xs text-slate-500 hover:text-slate-800"
                >
                  신청중 전체 선택
                </button>
                <button
                  type="button"
                  disabled={completing || selectedPendingCount === 0}
                  onClick={() => void receiveSelected()}
                  className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {completing ? '처리 중…' : `접수완료 처리 (${selectedPendingCount})`}
                </button>
              </>
            ) : null}
          </div>
          {loading ? (
            <p className="p-4 text-sm text-slate-500">불러오는 중…</p>
          ) : items.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">신청 내역이 없습니다.</p>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="min-w-[520px] text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2">고객명</th>
                    <th className="px-3 py-2">상태</th>
                    <th className="px-3 py-2">신청일</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${
                        selectedId === row.id ? 'bg-orange-50/60' : ''
                      }`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {row.status === 'PENDING' ? (
                          <input
                            type="checkbox"
                            checked={!!checked[row.id]}
                            onChange={(e) => setChecked((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                          />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-medium break-words">{row.customer_name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(row.status)}`}
                        >
                          {managerChangeStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {fmtDateTimeSeoul(row.created_at)}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {row.status === 'PENDING' || row.status === 'RECEIVED' ? (
                          <div className="flex flex-wrap gap-1">
                            {row.status === 'PENDING' ? (
                              <button
                                type="button"
                                disabled={completing}
                                onClick={() => void receiveOne(row.id)}
                                className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                              >
                                접수완료
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={completing || rejecting}
                              onClick={() => openReject(row)}
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                            >
                              반려
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">신청 상세</h3>
          {selectedItem ? (
            <DetailCard item={selectedItem} />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              목록에서 항목을 선택하세요.
            </p>
          )}
        </div>
      </div>

      {rejectTarget ? (
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
                  <span className="text-slate-500">고객명</span>{' '}
                  <span className="font-medium text-slate-900">{rejectTarget.customer_name}</span>
                </div>
                <div>
                  <span className="text-slate-500">신청자</span>{' '}
                  <span className="font-medium text-slate-900">{rejectTarget.requester_name}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-slate-500">변경 후 담당자</span>{' '}
                  <span className="font-medium text-slate-900">
                    {rejectTarget.after_manager_name} / {rejectTarget.after_manager_phone}
                  </span>
                </div>
              </div>
            </div>
            <label className="mt-3 block text-xs font-medium text-slate-700">반려 사유 *</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="예) 정보 불일치 / 담당자 확인 필요 / 추가 자료 필요 등"
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
            {rejectError ? <p className="mt-2 text-xs text-red-600">{rejectError}</p> : null}
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
                onClick={() => void submitReject()}
                disabled={rejecting || !rejectReason.trim()}
                className="rounded bg-red-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              >
                {rejecting ? '반려 중…' : '반려 처리'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
