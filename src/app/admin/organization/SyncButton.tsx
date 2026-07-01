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

interface SyncRunResponse {
  success?: boolean;
  runId?: string;
  page?: number;
  fetched?: number;
  created?: number;
  updated?: number;
  errors?: number;
  hasMore?: boolean;
  error?: string;
}

async function readJsonResponse<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trimStart().slice(0, 60);
    if (preview.startsWith('<')) {
      throw new Error(
        '서버가 JSON 대신 HTML 페이지를 반환했습니다. 로그인 세션 또는 배포 설정을 확인하세요.',
      );
    }
    throw new Error('서버 응답을 읽을 수 없습니다.');
  }
}

export default function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Array<{ created_at: string; level: string; message: string; context: any }> | null>(null);

  async function handleSync() {
    setLoading(true);
    setProgress(null);
    setError(null);
    setErrorDetails(null);

    let runId: string | null = null;
    let page = 1;
    let totalFetched = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    try {
      while (true) {
        const payload: { runId?: string; page?: number } = runId ? { runId, page } : {};

        const res = await fetch('/api/sync/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const json = await readJsonResponse<SyncRunResponse>(res);

        if (!json) {
          setError(`동기화 실패 (HTTP ${res.status})`);
          return;
        }

        if (!res.ok || !json.success) {
          const errMsg = typeof json.error === 'string' ? json.error : '동기화 실패 (서버 오류)';
          setError(errMsg);
          return;
        }

        runId = json.runId ?? null;
        if (!runId) {
          setError('동기화 runId를 받지 못했습니다.');
          return;
        }

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

        if ((current.totalErrors ?? 0) > 0) {
          try {
            const lr = await fetch(`/api/sync/logs?runId=${encodeURIComponent(runId)}&limit=10`);
            const lj = (await lr.json()) as any;
            if (lr.ok && lj?.success) setErrorDetails(lj.data ?? []);
          } catch {
            // ignore
          }
        }

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
    } catch (e) {
      setError(e instanceof Error ? e.message : '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
      <button
        type="button"
        onClick={handleSync}
        disabled={loading}
        className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-orange-200 hover:bg-orange-50/60 hover:text-orange-950 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:justify-center"
      >
        {loading ? (
          <>
            <span
              className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
              aria-hidden
            />
            동기화 중…
          </>
        ) : (
          'TY Life 동기화'
        )}
      </button>

      {progress && (
        <div className="rounded-md border border-orange-100 bg-orange-50/80 px-2 py-1.5 text-[11px] text-orange-950 sm:text-right">
          <span className="font-semibold text-orange-800">페이지 {progress.page}</span>
          <span className="mx-1 text-orange-400">·</span>
          누적 <strong className="tabular-nums">{progress.totalFetched}</strong>건
          {progress.totalErrors > 0 && (
            <>
              <span className="mx-1 text-orange-400">·</span>
              <span className="font-medium text-red-600">오류 {progress.totalErrors}</span>
            </>
          )}
        </div>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}

      {errorDetails && errorDetails.length > 0 && (
        <div className="w-full max-w-[520px] text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-gray-700">
          <div className="font-semibold text-red-700 mb-1">최근 동기화 오류</div>
          <ul className="space-y-1">
            {errorDetails.slice(0, 10).map((e, idx) => (
              <li key={idx} className="text-red-700">
                <span className="font-mono text-[10px] text-red-500">{String(e.created_at).slice(0, 19).replace('T', ' ')}</span>{' '}
                <span className="font-semibold">{e.level}</span>{' '}
                <span>{e.message}</span>
                {e.context && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[10px] text-red-600">context 보기</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-red-700 bg-white/60 border border-red-200 rounded p-2">
                      {JSON.stringify(e.context, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-red-500 mt-1">상세 context는 서버 로그/DB(sync_logs)에서 확인 가능합니다.</div>
        </div>
      )}
    </div>
  );
}
