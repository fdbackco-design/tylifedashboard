'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Progress {
  runId: string;
  page: number;
  totalFetched: number;
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
}

export default function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSync() {
    setLoading(true);
    setProgress(null);
    setError(null);

    let runId: string | null = null;
    let page = 1;
    let totalFetched = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    try {
      while (true) {
        const body = runId ? { runId, page } : {};

        const res = await fetch('/api/sync/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        const json = (await res.json()) as {
          success?: boolean;
          runId?: string;
          page?: number;
          fetched?: number;
          created?: number;
          updated?: number;
          errors?: number;
          hasMore?: boolean;
          error?: string;
        };

        if (!res.ok || !json.success) {
          const errMsg = typeof json.error === 'string' ? json.error : '동기화 실패 (서버 오류)';
          setError(errMsg);
          return;
        }

        runId = json.runId!;
        totalFetched += json.fetched ?? 0;
        totalCreated += json.created ?? 0;
        totalUpdated += json.updated ?? 0;
        totalErrors += json.errors ?? 0;

        const current: Progress = {
          runId,
          page,
          totalFetched,
          totalCreated,
          totalUpdated,
          totalErrors,
        };
        setProgress(current);

        if (!json.hasMore) {
          // 완료 처리
          await fetch('/api/sync/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId, finish: true }),
          });
          setProgress(null);
          router.refresh();
          return;
        }

        page++;
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

      {progress && (
        <div className="text-xs text-right bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-gray-700">
          <span className="text-blue-600 font-semibold">페이지 {progress.page} 처리 중</span>
          <span className="mx-1">·</span>
          누적 <strong>{progress.totalFetched}</strong>건
          {progress.totalErrors > 0 && (
            <>
              <span className="mx-1">·</span>
              <span className="text-red-500">오류 {progress.totalErrors}</span>
            </>
          )}
        </div>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}
