'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fmtDateTimeSeoul,
  formatManagerChangeCodesLine,
  managerChangeStatusLabel,
} from '@/lib/manager-change/format';

type ContractGroup = {
  group_key: string;
  contract_ids: string[];
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  resident_number: string;
  join_date: string;
  item_name: string;
  contract_codes: string;
  account_count: number;
  current_manager_name: string;
  statuses: string[];
};

function contractStatusClass(status: string): string {
  switch (status) {
    case '가입':
    case '정산완료':
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case '해약':
    case '취소':
      return 'bg-red-50 text-red-700 ring-red-200';
    case '렌탈 미충족':
      return 'bg-orange-50 text-orange-700 ring-orange-200';
    case '해피콜완료':
      return 'bg-cyan-50 text-cyan-700 ring-cyan-200';
    default:
      return 'bg-slate-100 text-slate-600 ring-slate-200';
  }
}

function ContractStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${contractStatusClass(status)}`}
    >
      {status}
    </span>
  );
}

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

export default function ManagerChangeClient(props: {
  initialItems: RequestItem[];
  canSubmit: boolean;
  requesterName: string;
  requesterPhone: string;
}) {
  const [groups, setGroups] = useState<ContractGroup[]>([]);
  const [items, setItems] = useState<RequestItem[]>(props.initialItems);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [selectedGroupKey, setSelectedGroupKey] = useState('');
  const [afterName, setAfterName] = useState('');
  const [afterPhone, setAfterPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const selectedGroup = useMemo(
    () => groups.find((g) => g.group_key === selectedGroupKey) ?? null,
    [groups, selectedGroupKey],
  );

  const codesLine = selectedGroup
    ? formatManagerChangeCodesLine(selectedGroup.contract_codes, selectedGroup.item_name)
    : '';

  const loadContracts = useCallback(async () => {
    if (!props.canSubmit) {
      setGroups([]);
      setLoadingContracts(false);
      return;
    }
    setLoadingContracts(true);
    setError('');
    try {
      const res = await fetch('/api/me/manager-change-requests/contracts', { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '계약 목록 조회 실패');
      setGroups((json?.groups ?? []) as ContractGroup[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGroups([]);
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
    if (!selectedGroup) {
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
          contract_ids: selectedGroup.contract_ids,
          after_manager_name: afterName.trim(),
          after_manager_phone: afterPhone.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? '신청 실패');
      setOk('담당자 변경 신청이 접수되었습니다.');
      setAfterName('');
      setAfterPhone('');
      setSelectedGroupKey('');
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
        <p className="mt-0.5 text-[11px] text-slate-500">
          고객·연락처·가입일·담당자·상품명이 동일한 계약은 한 번에 선택됩니다.
        </p>

        {loadingContracts ? (
          <p className="mt-4 text-sm text-slate-500">계약 목록 불러오는 중…</p>
        ) : groups.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">표시할 계약이 없습니다.</p>
        ) : (
          <>
            {/* 모바일: 카드 목록 */}
            <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto sm:hidden">
              {groups.map((g) => {
                const selected = selectedGroupKey === g.group_key;
                const multi = g.contract_ids.length > 1;
                return (
                  <label
                    key={g.group_key}
                    className={`block cursor-pointer rounded-xl border p-3 transition ${
                      selected
                        ? 'border-orange-300 bg-orange-50 ring-1 ring-orange-200/60'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="contract-group"
                        checked={selected}
                        onChange={() => setSelectedGroupKey(g.group_key)}
                        disabled={submitting}
                        className="mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 break-keep">{g.customer_name}</p>
                          {multi ? (
                            <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                              {g.contract_ids.length}건
                            </span>
                          ) : null}
                          {g.statuses.map((s) => (
                            <ContractStatusBadge key={s} status={s} />
                          ))}
                        </div>
                        <p className="mt-1 font-mono text-[11px] leading-snug text-slate-700 break-all">
                          {g.contract_codes}
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 break-keep">{g.item_name}</p>
                        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                          <div className="min-w-0">
                            <dt className="text-slate-400">연락처</dt>
                            <dd className="mt-0.5 whitespace-nowrap tabular-nums text-slate-700">
                              {g.customer_phone ?? '-'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">가입일</dt>
                            <dd className="mt-0.5 tabular-nums text-slate-700">{g.join_date || '-'}</dd>
                          </div>
                          <div>
                            <dt className="text-slate-400">구좌</dt>
                            <dd className="mt-0.5 tabular-nums text-slate-700">{g.account_count}구좌</dd>
                          </div>
                          <div className="col-span-2 min-w-0">
                            <dt className="text-slate-400">현재 담당자</dt>
                            <dd className="mt-0.5 break-keep text-slate-700">{g.current_manager_name}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {/* 데스크톱: 가로 스크롤 테이블 */}
            <div className="mt-3 hidden max-h-[320px] overflow-auto rounded-lg border border-slate-200 sm:block">
              <table className="min-w-[800px] w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-12 px-3 py-2">선택</th>
                    <th className="whitespace-nowrap px-3 py-2">고객명</th>
                    <th className="whitespace-nowrap px-3 py-2">연락처</th>
                    <th className="whitespace-nowrap px-3 py-2">가입일</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">구좌</th>
                    <th className="whitespace-nowrap px-3 py-2">상태</th>
                    <th className="whitespace-nowrap px-3 py-2">코드</th>
                    <th className="min-w-[12rem] px-3 py-2">상품명</th>
                    <th className="whitespace-nowrap px-3 py-2">현재 담당자</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr
                      key={g.group_key}
                      className={`border-t border-slate-100 ${selectedGroupKey === g.group_key ? 'bg-orange-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="radio"
                          name="contract-group"
                          checked={selectedGroupKey === g.group_key}
                          onChange={() => setSelectedGroupKey(g.group_key)}
                          disabled={submitting}
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                        {g.customer_name}
                        {g.contract_ids.length > 1 ? (
                          <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                            ({g.contract_ids.length}건)
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                        {g.customer_phone ?? '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                        {g.join_date || '-'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{g.account_count}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {g.statuses.map((s) => (
                            <ContractStatusBadge key={s} status={s} />
                          ))}
                        </div>
                      </td>
                      <td className="max-w-[10rem] px-3 py-2 font-mono text-[11px] text-slate-700 break-all leading-snug">
                        {g.contract_codes}
                      </td>
                      <td className="max-w-[14rem] px-3 py-2 text-slate-600 break-keep leading-snug">
                        {g.item_name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">{g.current_manager_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5">
        <h2 className="text-sm font-semibold text-slate-900 sm:text-base">담당자 변경 신청</h2>
        {selectedGroup ? (
          <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-slate-500">고객명</span>
              <p className="font-medium">{selectedGroup.customer_name}</p>
            </div>
            <div>
              <span className="text-slate-500">주민번호</span>
              <p className="font-medium">{selectedGroup.resident_number}</p>
            </div>
            <div>
              <span className="text-slate-500">연락처</span>
              <p className="font-medium">{selectedGroup.customer_phone ?? '-'}</p>
            </div>
            <div>
              <span className="text-slate-500">가입구좌</span>
              <p className="font-medium">{selectedGroup.account_count}구좌</p>
            </div>
            <div className="sm:col-span-2">
              <span className="text-slate-500">회원 코드 및 제품명</span>
              <p className="break-words font-medium">{codesLine}</p>
            </div>
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
            <input
              readOnly
              value="Ty Life Partners"
              className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700"
            />
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
                <th className="px-3 py-2">회원 코드 및 제품명</th>
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
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    신청 이력이 없습니다.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{row.customer_name}</td>
                    <td className="px-3 py-2 break-words text-slate-600">
                      {formatManagerChangeCodesLine(row.contract_codes, row.item_name)}
                    </td>
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
