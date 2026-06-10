'use client';

/**
 * 정산 담당자 override 패널 (관리자 전용)
 *
 * 기능
 *   1. 계약 검색 (계약코드/고객명 부분일치)
 *   2. 결과 행에서 [정산 담당자 변경] 클릭 → 모달 오픈
 *   3. 모달에서 새 담당자 검색·선택 + 사유 입력 → 저장
 *   4. override 해제 (정산 담당자 = NULL → 원본 sales_member_id 그대로 사용)
 *   5. 변경 이력 미리보기
 *
 * 본 패널은 기존 조직도 노드 이동/렌더 로직과 완전히 독립이며,
 * 정산용 컬럼(settlement_sales_member_id 등) 만 갱신한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type ContractRow = {
  contract_id: string;
  contract_code: string | null;
  join_date: string | null;
  unit_count: number | null;
  status: string | null;
  customer_name: string | null;
  sales_member_id: string | null;
  sales_member_name: string | null;
  settlement_sales_member_id: string | null;
  settlement_sales_member_name: string | null;
  sales_member_override_reason: string | null;
};

type MemberOption = {
  id: string;
  name: string;
  rank: string | null;
  external_id?: string | null;
  phone?: string | null;
  label: string;
};

type HistoryRow = {
  id: string;
  previous_settlement_sales_member_id: string | null;
  new_settlement_sales_member_id: string | null;
  previous_sales_member_id: string | null;
  reason: string | null;
  changed_by: string;
  changed_at: string;
};

function fmtDate(iso: string | null): string {
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

export default function SettlementSalesMemberOverridePanel() {
  const [q, setQ] = useState<string>('');
  const [searching, setSearching] = useState<boolean>(false);
  const [results, setResults] = useState<ContractRow[]>([]);
  const [searchError, setSearchError] = useState<string>('');
  const [selected, setSelected] = useState<ContractRow | null>(null);

  const search = useCallback(async (query: string) => {
    setSearchError('');
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/contracts/search?q=${encodeURIComponent(query)}&limit=30`, {
        credentials: 'include',
      });
      const json = await res.json();
      if (!res.ok) {
        setSearchError(json?.error ?? '검색 실패');
        setResults([]);
        return;
      }
      setResults((json?.results ?? []) as ContractRow[]);
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) {
      setResults([]);
      return;
    }
    void search(v);
  };

  const reloadRow = useCallback(async (contractId: string) => {
    try {
      const res = await fetch(
        `/api/admin/contracts/search?q=${encodeURIComponent(contractId.slice(0, 8))}&limit=30`,
        { credentials: 'include' },
      );
      const json = await res.json();
      if (!res.ok) return;
      const items = (json?.results ?? []) as ContractRow[];
      const fresh = items.find((r) => r.contract_id === contractId);
      if (fresh) {
        setResults((prev) => prev.map((r) => (r.contract_id === contractId ? fresh : r)));
        return fresh;
      }
    } catch {
      // ignore
    }
    return null;
  }, []);

  return (
    <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-amber-900">
            정산 담당자 보정 (settlement_sales_member_id)
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            TY 동기화 원본(<code>contracts.sales_member_id</code>)는 절대 수정하지 않으며,
            정산 계산에만 사용되는 <code>settlement_sales_member_id</code> 만 갱신합니다.
            TY 동기화를 다시 해도 이 값은 보존됩니다.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="계약코드 또는 고객명 검색"
          className="w-full max-w-sm rounded border border-amber-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={searching}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
        >
          {searching ? '검색 중…' : '검색'}
        </button>
        {searchError && (
          <span className="text-xs text-red-600">{searchError}</span>
        )}
      </form>

      {results.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-amber-100 text-amber-900">
              <tr>
                <th className="px-2 py-1 text-left">계약코드</th>
                <th className="px-2 py-1 text-left">고객</th>
                <th className="px-2 py-1 text-left">가입일</th>
                <th className="px-2 py-1 text-left">구좌</th>
                <th className="px-2 py-1 text-left">상태</th>
                <th className="px-2 py-1 text-left">원본 담당자(TY)</th>
                <th className="px-2 py-1 text-left">정산 담당자(override)</th>
                <th className="px-2 py-1 text-left">동작</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.contract_id} className="border-t border-amber-100">
                  <td className="px-2 py-1 font-mono">{r.contract_code ?? '-'}</td>
                  <td className="px-2 py-1">{r.customer_name ?? '-'}</td>
                  <td className="px-2 py-1">{r.join_date ?? '-'}</td>
                  <td className="px-2 py-1">{r.unit_count ?? '-'}</td>
                  <td className="px-2 py-1">{r.status ?? '-'}</td>
                  <td className="px-2 py-1">
                    {r.sales_member_name ?? (
                      <span className="text-gray-400">(미지정)</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {r.settlement_sales_member_name ? (
                      <span className="font-medium text-amber-900">
                        {r.settlement_sales_member_name}
                      </span>
                    ) : (
                      <span className="text-gray-400">(없음)</span>
                    )}
                    {r.sales_member_override_reason && (
                      <div className="text-[10px] text-amber-700">
                        사유: {r.sales_member_override_reason}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setSelected(r)}
                      className="rounded border border-amber-400 bg-white px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      정산 담당자 변경
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {results.length === 0 && q.trim() && !searching && !searchError && (
        <p className="mt-3 text-xs text-gray-500">검색 결과 없음.</p>
      )}

      {selected && (
        <OverrideModal
          contract={selected}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            const fresh = await reloadRow(selected.contract_id);
            if (fresh) setSelected(fresh);
            else setSelected(null);
          }}
        />
      )}

      <OrgBasedAutoFixSection />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 조직도 기준 정산 담당자 자동 보정 (미리보기 → 선택 → 일괄 적용)
// ─────────────────────────────────────────────────────────────────────────────

type DiffRow = {
  contract_id: string;
  contract_code: string | null;
  customer_name: string | null;
  unit_count: number | null;
  status: string | null;
  ty_sales_member_id: string | null;
  ty_sales_member_name: string | null;
  current_settlement_sales_member_id: string | null;
  current_settlement_sales_member_name: string | null;
  org_based_sales_member_id: string | null;
  org_based_sales_member_name: string | null;
  proposed_settlement_sales_member_id: string | null;
  eligible_for_auto_apply: boolean;
  skip_reason: string | null;
  decision: string;
};

type PreviewSummary = {
  total_scanned: number;
  total_diff: number;
  auto_eligible: number;
  skipped_by_reason: Record<string, number>;
};

function OrgBasedAutoFixSection() {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [diffs, setDiffs] = useState<DiffRow[]>([]);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState<string>('조직도 수동 수정 기준 정산 담당자 자동 보정');
  const [changedBy, setChangedBy] = useState<string>('admin');
  const [applying, setApplying] = useState<boolean>(false);
  const [applyMessage, setApplyMessage] = useState<string>('');

  const runPreview = useCallback(async () => {
    setError('');
    setApplyMessage('');
    setLoading(true);
    try {
      const res = await fetch(
        '/api/admin/contracts/settlement-sales-member/preview',
        { method: 'POST', credentials: 'include' },
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? '미리보기 실패');
        setDiffs([]);
        setSummary(null);
        return;
      }
      const list = (json?.diffs ?? []) as DiffRow[];
      setDiffs(list);
      setSummary((json?.summary ?? null) as PreviewSummary | null);
      // 자동 적용 가능한 항목을 기본 체크
      const next: Record<string, boolean> = {};
      for (const d of list) if (d.eligible_for_auto_apply) next[d.contract_id] = true;
      setChecked(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = (id: string, on: boolean) => {
    setChecked((prev) => ({ ...prev, [id]: on }));
  };

  const toggleAllEligible = (on: boolean) => {
    const next: Record<string, boolean> = { ...checked };
    for (const d of diffs) {
      if (d.eligible_for_auto_apply) next[d.contract_id] = on;
    }
    setChecked(next);
  };

  const selectedCount = diffs.filter(
    (d) => d.eligible_for_auto_apply && checked[d.contract_id],
  ).length;

  const apply = useCallback(async () => {
    setError('');
    setApplyMessage('');
    const items = diffs
      .filter((d) => d.eligible_for_auto_apply && checked[d.contract_id])
      .map((d) => ({
        contract_id: d.contract_id,
        settlement_sales_member_id: d.proposed_settlement_sales_member_id!,
      }));
    if (items.length === 0) {
      setError('적용할 항목을 선택하세요.');
      return;
    }
    if (!confirm(`${items.length}건의 정산 담당자를 일괄 적용합니다. 진행할까요?`)) return;

    setApplying(true);
    try {
      const res = await fetch(
        '/api/admin/contracts/settlement-sales-member/bulk-apply',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ items, reason, changed_by: changedBy }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? '일괄 적용 실패');
        return;
      }
      setApplyMessage(
        `완료: 성공 ${json?.success_count ?? 0}건 / 실패 ${json?.fail_count ?? 0}건`,
      );
      // 적용 후 자동 재조회로 잔여 diff 확인
      await runPreview();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  }, [diffs, checked, reason, changedBy, runPreview]);

  return (
    <div className="mt-6 rounded-md border border-amber-300 bg-white p-3">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-amber-900">
            조직도 기준 정산 담당자 자동 보정
          </h3>
          <p className="mt-0.5 text-[11px] text-amber-700">
            현재 조직도 구조 기준 담당자와 정산용 담당자가 다른 계약을 찾아 미리보기 한 뒤,
            선택한 항목만 일괄 적용합니다. <b>contracts.sales_member_id 는 절대 수정하지 않습니다.</b>
          </p>
        </div>
        <button
          type="button"
          onClick={runPreview}
          disabled={loading}
          className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60"
        >
          {loading ? '분석 중…' : '현재 조직도 기준으로 정산 담당자 보정 대상 찾기'}
        </button>
      </header>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {applyMessage && <p className="text-xs text-emerald-700">{applyMessage}</p>}

      {summary && (
        <div className="mb-2 rounded border bg-amber-50/40 p-2 text-[11px] text-amber-900">
          전체 스캔 {summary.total_scanned}건 · 차이 발견 {summary.total_diff}건 · 자동 적용 가능 {summary.auto_eligible}건
          {Object.keys(summary.skipped_by_reason ?? {}).length > 0 && (
            <div className="mt-1 text-amber-800">
              제외 사유: {Object.entries(summary.skipped_by_reason).map(([k, v]) => `${k}(${v})`).join(' · ')}
            </div>
          )}
        </div>
      )}

      {diffs.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => toggleAllEligible(true)}
              className="rounded border px-2 py-0.5 hover:bg-amber-50"
            >
              적용 가능 전체 선택
            </button>
            <button
              type="button"
              onClick={() => toggleAllEligible(false)}
              className="rounded border px-2 py-0.5 hover:bg-amber-50"
            >
              전체 해제
            </button>
            <span className="text-amber-800">선택됨 {selectedCount}건</span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-[11px]">
              <thead className="bg-amber-100 text-amber-900">
                <tr>
                  <th className="px-1 py-1">적용</th>
                  <th className="px-2 py-1 text-left">계약코드</th>
                  <th className="px-2 py-1 text-left">고객</th>
                  <th className="px-2 py-1 text-left">구좌</th>
                  <th className="px-2 py-1 text-left">상태</th>
                  <th className="px-2 py-1 text-left">TY 원본</th>
                  <th className="px-2 py-1 text-left">현재 정산</th>
                  <th className="px-2 py-1 text-left">조직도 기준 / 변경 예정</th>
                  <th className="px-2 py-1 text-left">근거</th>
                  <th className="px-2 py-1 text-left">제외 사유</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((d) => (
                  <tr
                    key={d.contract_id}
                    className={`border-t ${
                      d.eligible_for_auto_apply ? '' : 'bg-gray-50 text-gray-500'
                    }`}
                  >
                    <td className="px-1 py-1 text-center">
                      <input
                        type="checkbox"
                        disabled={!d.eligible_for_auto_apply}
                        checked={!!checked[d.contract_id]}
                        onChange={(e) => toggle(d.contract_id, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-1 font-mono">{d.contract_code ?? '-'}</td>
                    <td className="px-2 py-1">{d.customer_name ?? '-'}</td>
                    <td className="px-2 py-1">{d.unit_count ?? '-'}</td>
                    <td className="px-2 py-1">{d.status ?? '-'}</td>
                    <td className="px-2 py-1">{d.ty_sales_member_name ?? '(없음)'}</td>
                    <td className="px-2 py-1">
                      {d.current_settlement_sales_member_name ?? (
                        <span className="text-gray-400">(원본 사용)</span>
                      )}
                    </td>
                    <td className="px-2 py-1 font-medium text-amber-900">
                      {d.org_based_sales_member_name ?? '-'}
                    </td>
                    <td className="px-2 py-1">{d.decision}</td>
                    <td className="px-2 py-1 text-red-600">{d.skip_reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-0.5 block text-[11px] text-gray-700">변경 사유</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded border px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[11px] text-gray-700">작업자</label>
              <input
                value={changedBy}
                onChange={(e) => setChangedBy(e.target.value)}
                className="w-full rounded border px-2 py-1 text-xs"
              />
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={apply}
              disabled={applying || selectedCount === 0}
              className="rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60"
            >
              {applying ? '적용 중…' : `선택한 ${selectedCount}건 일괄 적용`}
            </button>
          </div>
        </>
      )}

      {summary && summary.total_diff === 0 && diffs.length === 0 && (
        <p className="text-[11px] text-gray-500">
          현재 조직도 기준과 다른 정산 담당자가 발견되지 않았습니다.
        </p>
      )}
    </div>
  );
}

function OverrideModal(props: {
  contract: ContractRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { contract, onClose, onSaved } = props;
  const [memberQuery, setMemberQuery] = useState<string>('');
  const [memberResults, setMemberResults] = useState<MemberOption[]>([]);
  const [memberSearching, setMemberSearching] = useState<boolean>(false);
  const [selectedMember, setSelectedMember] = useState<MemberOption | null>(null);
  const [reason, setReason] = useState<string>('');
  const [changedBy, setChangedBy] = useState<string>('admin');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/contracts/${contract.contract_id}/settlement-sales-member`,
          { credentials: 'include' },
        );
        const json = await res.json();
        if (res.ok) setHistory((json?.history ?? []) as HistoryRow[]);
      } catch {
        // ignore
      }
    })();
  }, [contract.contract_id]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = memberQuery.trim();
    if (!q) {
      setMemberResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setMemberSearching(true);
      try {
        const res = await fetch(
          `/api/admin/organization-members/search?q=${encodeURIComponent(q)}&limit=20`,
          { credentials: 'include' },
        );
        const json = await res.json();
        if (res.ok) setMemberResults((json?.results ?? []) as MemberOption[]);
      } catch {
        // ignore
      } finally {
        setMemberSearching(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [memberQuery]);

  const save = useCallback(
    async (mode: 'set' | 'clear') => {
      setError('');
      if (mode === 'set' && !selectedMember) {
        setError('새 정산 담당자를 선택하세요.');
        return;
      }
      setSaving(true);
      try {
        const res = await fetch(
          `/api/admin/contracts/${contract.contract_id}/settlement-sales-member`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              settlement_sales_member_id: mode === 'clear' ? null : selectedMember!.id,
              reason: reason.trim() || null,
              changed_by: changedBy.trim() || 'admin',
            }),
          },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json?.error ?? '저장 실패');
          return;
        }
        await onSaved();
      } finally {
        setSaving(false);
      }
    },
    [contract.contract_id, selectedMember, reason, changedBy, onSaved],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
        <div className="border-b px-4 py-3">
          <h3 className="text-base font-semibold">정산 담당자 보정</h3>
          <p className="mt-1 text-xs text-gray-600">
            계약 <span className="font-mono">{contract.contract_code ?? '-'}</span> /
            고객 {contract.customer_name ?? '-'}
          </p>
        </div>

        <div className="space-y-3 px-4 py-3 text-sm">
          <div className="rounded border bg-gray-50 p-2 text-xs">
            <div>
              원본 담당자(TY): <b>{contract.sales_member_name ?? '(미지정)'}</b>
            </div>
            <div>
              현재 정산 담당자(override):{' '}
              <b className="text-amber-700">
                {contract.settlement_sales_member_name ?? '(없음 → 원본 사용)'}
              </b>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-700">새 정산 담당자 검색</label>
            <input
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="조직원 이름"
              className="w-full rounded border px-2 py-1 text-sm"
            />
            {memberSearching && (
              <p className="mt-1 text-[11px] text-gray-500">검색 중…</p>
            )}
            {memberResults.length > 0 && (
              <ul className="mt-1 max-h-40 overflow-y-auto rounded border bg-white">
                {memberResults.map((m) => (
                  <li
                    key={m.id}
                    onClick={() => setSelectedMember(m)}
                    className={`cursor-pointer px-2 py-1 text-xs hover:bg-amber-50 ${
                      selectedMember?.id === m.id ? 'bg-amber-100 font-medium' : ''
                    }`}
                  >
                    {m.label}
                  </li>
                ))}
              </ul>
            )}
            {selectedMember && (
              <p className="mt-1 text-xs text-amber-800">
                선택됨: <b>{selectedMember.label}</b>
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-700">수정 사유 (필수 권장)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="예) TY 본사 담당자 입력 오류 보정 - 실제 담당자는 OOO"
              className="w-full rounded border px-2 py-1 text-sm"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-700">작업자</label>
            <input
              value={changedBy}
              onChange={(e) => setChangedBy(e.target.value)}
              className="w-full rounded border px-2 py-1 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          {history.length > 0 && (
            <details className="mt-2 rounded border bg-gray-50 p-2 text-[11px] text-gray-700">
              <summary className="cursor-pointer">최근 변경 이력 ({history.length})</summary>
              <ul className="mt-2 space-y-1">
                {history.map((h) => (
                  <li key={h.id} className="border-t pt-1">
                    <div>
                      {fmtDate(h.changed_at)} · {h.changed_by}
                    </div>
                    <div className="text-gray-600">
                      {h.previous_settlement_sales_member_id ?? '(원본)'} →{' '}
                      {h.new_settlement_sales_member_id ?? '(해제)'}
                    </div>
                    {h.reason && (
                      <div className="text-gray-500">사유: {h.reason}</div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            닫기
          </button>
          {contract.settlement_sales_member_id && (
            <button
              type="button"
              onClick={() => save('clear')}
              disabled={saving}
              className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-100"
            >
              override 해제
            </button>
          )}
          <button
            type="button"
            onClick={() => save('set')}
            disabled={saving || !selectedMember}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {saving ? '저장 중…' : '정산 담당자로 저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
