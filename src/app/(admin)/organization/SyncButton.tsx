'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SyncResult {
  run_id: string;
  status: string;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_errors: number;
  duration_ms: number;
}

export default function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch('/api/sync/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const json = (await res.json()) as {
        success?: boolean;
        result?: SyncResult;
        error?: string;
      };

      if (!res.ok || !json.success) {
        setError(json.error ?? '동기화 실패');
      } else {
        setResult(json.result!);
        router.refresh();
      }
    } catch {
      setError('네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleSync}
        disabled={loading}
        className="px-4 py-2 text-sm rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? '동기화 중...' : 'TY Life 동기화'}
      </button>

      {loading && (
        <span className="text-xs text-gray-500">
          전체 페이지를 가져오는 중입니다. 잠시 기다려 주세요...
        </span>
      )}

      {result && (
        <div className="text-xs text-right bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-gray-700">
          <span className="text-green-700 font-semibold">동기화 완료</span>
          <span className="mx-1">·</span>
          조회 <strong>{result.total_fetched}</strong>건
          <span className="mx-1">·</span>
          신규 <strong>{result.total_created}</strong>
          <span className="mx-1">·</span>
          갱신 <strong>{result.total_updated}</strong>
          {result.total_errors > 0 && (
            <>
              <span className="mx-1">·</span>
              <span className="text-red-500">오류 {result.total_errors}</span>
            </>
          )}
          <span className="mx-1">·</span>
          {(result.duration_ms / 1000).toFixed(1)}초
        </div>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}
