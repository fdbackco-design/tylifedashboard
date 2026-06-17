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
  status: 'PENDING' | 'COMPLETED' | string;
  created_at: string;
  completed_at: string | null;
};

type StatusFilter = 'ALL' | 'PENDING' | 'COMPLETED';

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
            {item.before_manager_name} / {item.before_manager_phone ?? '-'}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-slate-500">-변경 후 담당자명 / 연락처</dt>
          <dd className="mt-0.5 font-medium text-orange-700">
            {item.after_manager_name} / {item.after_manager_phone}
          </dd>
        </div>
      </dl>
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

  async function completeSelected() {
    const ids = pendingIds.filter((id) => checked[id]);
    if (ids.length === 0) {
      setError('완료 처리할 신청중 항목을 선택하세요.');
      return;
    }
    setCompleting(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/manager-change-requests/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '완료 처리 실패');
      setMessage(`${(json?.completedIds ?? []).length}건 완료 처리했습니다.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompleting(false);
    }
  }

  async function completeOne(id: string) {
    setCompleting(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/admin/manager-change-requests/complete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '완료 처리 실패');
      setMessage('완료 처리했습니다.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['ALL', 'PENDING', 'COMPLETED'] as const).map((s) => (
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
                  onClick={() => void completeSelected()}
                  className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {completing ? '처리 중…' : `완료 처리 (${selectedPendingCount})`}
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
              <table className="min-w-full text-sm">
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
                      <td className="px-3 py-2 font-medium">{row.customer_name}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            row.status === 'COMPLETED'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-700'
                          }`}
                        >
                          {managerChangeStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {fmtDateTimeSeoul(row.created_at)}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {row.status === 'PENDING' ? (
                          <button
                            type="button"
                            disabled={completing}
                            onClick={() => void completeOne(row.id)}
                            className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                          >
                            완료 처리
                          </button>
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
    </div>
  );
}
