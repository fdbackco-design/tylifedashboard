'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtDateTimeSeoul, managerChangeStatusLabel } from '@/lib/manager-change/format';

type ContractRow = {
  id: string;
  contract_code: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  resident_number: string;
  unit_count: number;
  item_name: string;
  current_manager_name: string;
};

type RequestItem = {
  id: string;
  contract_id: string;
  customer_name: string;
  contract_codes: string;
  item_name: string;
  after_manager_name: string;
  after_manager_phone: string;
  status: string;
  created_at: string;
  completed_at: string | null;
};

type SelectionDetail = {
  customer_name: string;
  resident_number: string;
  customer_phone: string | null;
  account_count: number;
  contract_codes: string;
  item_name: string;
};

function buildSelection(contracts: ContractRow[], selectedId: string): SelectionDetail | null {
  const selected = contracts.find((c) => c.id === selectedId);
  if (!selected) return null;
  const siblings = contracts.filter(
    (c) => c.customer_id === selected.customer_id && c.item_name === selected.item_name,
  );
  return {
    customer_name: selected.customer_name,
    resident_number: selected.resident_number,
    customer_phone: selected.customer_phone,
    account_count: siblings.reduce((s, c) => s + c.unit_count, 0),
    contract_codes: siblings.map((c) => c.contract_code).join(' / '),
    item_name: selected.item_name,
  };
}

export default function ManagerChangeClient(props: {
  initialItems: RequestItem[];
  canSubmit: boolean;
  requesterName: string;
  requesterPhone: string;
}) {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [items, setItems] = useState<RequestItem[]>(props.initialItems);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState('');
  const [afterName, setAfterName] = useState('');
  const [afterPhone, setAfterPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const selection = useMemo(
    () => (selectedContractId ? buildSelection(contracts, selectedContractId) : null),
    [contracts, selectedContractId],
  );

  const loadContracts = useCallback(async () => {
    if (!props.canSubmit) {
      setContracts([]);
      setLoadingContracts(false);
      return;
    }
    setLoadingContracts(true);
    setError('');
    try {
      const res = await fetch('/api/me/manager-change-requests/contracts', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '계약 목록 조회 실패');
      setContracts((json?.contracts ?? []) as ContractRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setContracts([]);
    } finally {
      setLoadingContracts(false);
    }
  }, [props.canSubmit]);

  const reloadItems = useCallback(async () => {
    const res = await fetch('/api/me/manager-change-requests', { credentials: 'include' });
    const json = await res.json();
    if (res.ok) setItems((json?.items ?? []) as RequestItem[]);
  }, []);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts]);

  useEffect(() => {
    if (!ok) return;
    const t = setTimeout(() => setOk(''), 2500);
    return () => clearTimeout(t);
  }, [ok]);

  async function submit() {
    if (!props.canSubmit || submitting) return;
    setError('');
    setOk('');
    if (!selectedContractId) {
      setError('계약을 선택하세요.');
      return;
    }
    if (!afterName.trim()) {
      setError('변경 후 담당자명을 입력하세요.');
      return;
    }
    if (!afterPhone.trim()) {
      setError('변경 후 담당자 연락처를 입력하세요.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/me/manager-change-requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_id: selectedContractId,
          after_manager_name: afterName.trim(),
          after_manager_phone: afterPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '신청 실패');
      setOk('담당자 변경 신청이 접수되었습니다.');
      setAfterName('');
      setAfterPhone('');
      setSelectedContractId('');
      await reloadItems();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {!props.canSubmit ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          조직 매핑이 완료된 후 담당자 변경 신청을 이용할 수 있습니다.
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900 sm:text-base">산하 계약 목록</h2>
        <p className="mt-0.5 text-[11px] text-slate-500">신청할 계약을 선택하세요.</p>

        {loadingContracts ? (
          <p className="mt-4 text-sm text-slate-500">계약 목록 불러오는 중…</p>
        ) : contracts.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">표시할 계약이 없습니다.</p>
        ) : (
          <div className="mt-3 max-h-[320px] overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">선택</th>
                  <th className="px-3 py-2">고객명</th>
                  <th className="px-3 py-2">연락처</th>
                  <th className="px-3 py-2 text-right">구좌</th>
                  <th className="px-3 py-2">코드</th>
                  <th className="px-3 py-2">상품명</th>
                  <th className="px-3 py-2">현재 담당자</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-t border-slate-100 ${selectedContractId === c.id ? 'bg-orange-50' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="radio"
                        name="contract"
                        checked={selectedContractId === c.id}
                        onChange={() => setSelectedContractId(c.id)}
                        disabled={submitting}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">{c.customer_name}</td>
                    <td className="px-3 py-2 text-slate-600">{c.customer_phone ?? '-'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.unit_count}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-700">{c.contract_code}</td>
                    <td className="px-3 py-2 text-slate-600">{c.item_name}</td>
                    <td className="px-3 py-2 text-slate-700">{c.current_manager_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900 sm:text-base">담당자 변경 신청</h2>
        {selection ? (
          <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-sm sm:grid-cols-2">
            <div><span className="text-slate-500">고객명</span><p className="font-medium">{selection.customer_name}</p></div>
            <div><span className="text-slate-500">주민번호</span><p className="font-medium">{selection.resident_number}</p></div>
            <div><span className="text-slate-500">연락처</span><p className="font-medium">{selection.customer_phone ?? '-'}</p></div>
            <div><span className="text-slate-500">가입 구좌 수</span><p className="font-medium">{selection.account_count}구좌</p></div>
            <div className="sm:col-span-2"><span className="text-slate-500">contract_code</span><p className="font-mono text-xs">{selection.contract_codes}</p></div>
            <div className="sm:col-span-2"><span className="text-slate-500">item_name</span><p>{selection.item_name}</p></div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-500">계약을 선택하면 상세 정보가 자동으로 채워집니다.</p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">변경 전 담당자명</label>
            <input
              readOnly
              value={props.requesterName}
              className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">변경 전 담당자 연락처</label>
            <input
              readOnly
              value={props.requesterPhone || '-'}
              className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">소속 지사명</label>
            <input readOnly value="Ty Life Partners" className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700" />
          </div>
          <div />
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">변경 후 담당자명 *</label>
            <input
              value={afterName}
              onChange={(e) => setAfterName(e.target.value)}
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              disabled={!props.canSubmit || submitting}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">변경 후 담당자 연락처 *</label>
            <input
              value={afterPhone}
              onChange={(e) => setAfterPhone(e.target.value)}
              inputMode="tel"
              placeholder="010-1234-1234"
              className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm"
              disabled={!props.canSubmit || submitting}
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {ok ? <p className="mt-3 text-sm text-emerald-700">{ok}</p> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!props.canSubmit || submitting}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-gradient-to-b from-orange-500 to-orange-600 px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
        >
          {submitting ? '신청 중…' : '신청하기'}
        </button>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.035]">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">내 신청 이력</h2>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">고객명</th>
                <th className="px-3 py-2">코드</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2">변경 후 담당자</th>
                <th className="px-3 py-2">연락처</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">신청일</th>
                <th className="px-3 py-2">완료일</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">신청 이력이 없습니다.</td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{row.customer_name}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{row.contract_codes}</td>
                    <td className="px-3 py-2 text-slate-600">{row.item_name}</td>
                    <td className="px-3 py-2">{row.after_manager_name}</td>
                    <td className="px-3 py-2">{row.after_manager_phone}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          row.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {managerChangeStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDateTimeSeoul(row.created_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDateTimeSeoul(row.completed_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
