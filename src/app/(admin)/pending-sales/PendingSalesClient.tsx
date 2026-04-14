'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type PendingRow = {
  id: string;
  contract_code: string;
  join_date: string;
  status: string;
  unit_count: number;
  raw_sales_member_name: string | null;
  customers: { name: string } | null;
  name_candidates_same_name: { id: string; name: string; rank: string }[];
  all_members_fallback: { id: string; name: string; rank: string }[];
};

export default function PendingSalesClient() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/contracts/pending-mapping');
      const json = (await res.json()) as { data?: PendingRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? '조회 실패');
      setRows(json.data ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function linkContract(contractId: string, memberId: string) {
    setLinkingId(contractId);
    setErr(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/link-sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '연결 실패');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLinkingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500">불러오는 중…</p>;
  }

  if (err) {
    return (
      <p className="text-sm text-red-600">
        {err}{' '}
        <button type="button" onClick={() => void load()} className="underline">
          다시 시도
        </button>
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-gray-500">미확인 담당자 계약이 없습니다.</p>;
  }

  return (
    <div className="space-y-6">
      {rows.map((row) => {
        const customerName = row.customers?.name ?? '-';
        const raw = row.raw_sales_member_name ?? '';
        const candidates = row.name_candidates_same_name;
        const busy = linkingId === row.id;

        return (
          <div
            key={row.id}
            className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div>
                <Link
                  href={`/contracts/${row.id}`}
                  className="font-mono text-sm font-semibold text-blue-600 hover:underline"
                >
                  {row.contract_code}
                </Link>
                <span className="text-gray-400 mx-2">·</span>
                <span className="text-sm text-gray-600">고객 {customerName}</span>
              </div>
              <span className="text-xs text-gray-400">
                가입 {row.join_date} · {row.status} · {row.unit_count}구좌
              </span>
            </div>
            <p className="text-sm text-gray-700 mb-3">
              수집된 담당자명: <strong className="text-gray-900">{raw || '(없음)'}</strong>
            </p>

            {candidates.length > 0 ? (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">
                  동명이인이 여러 명입니다. 해당 담당자를 한 번만 선택하세요.
                </p>
                <div className="flex flex-wrap gap-2">
                  {candidates.map((m, idx) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void linkContract(row.id, m.id)}
                      className="px-3 py-1.5 text-sm rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                    >
                      {idx + 1}번 {m.name} ({m.rank})
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-amber-700 mb-2">
                  조직도에 동일 이름이 없습니다. 아래에서 실제 담당자를 선택하세요.
                </p>
                <select
                  disabled={busy}
                  className="w-full max-w-md text-sm border border-gray-300 rounded px-2 py-2"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void linkContract(row.id, v);
                    e.target.value = '';
                  }}
                >
                  <option value="">담당자 선택…</option>
                  {row.all_members_fallback.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.rank}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
