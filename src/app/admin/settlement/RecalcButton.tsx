'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  yearMonth: string;
}

export default function RecalcButton({ yearMonth }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function handleRecalc() {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch('/api/settlement/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_month: yearMonth }),
      });

      const json = await res.json() as { success?: boolean; result?: { updated_count: number }; error?: string };

      if (!res.ok || !json.success) {
        setMessage({ text: json.error ?? '계산 실패', ok: false });
      } else {
        setMessage({ text: `${json.result?.updated_count ?? 0}명 정산 완료`, ok: true });
        router.refresh();
      }
    } catch {
      setMessage({ text: '네트워크 오류', ok: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <button
        type="button"
        onClick={handleRecalc}
        disabled={loading}
        className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-orange-200 hover:bg-orange-50/70 hover:text-orange-950 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {loading ? (
          <>
            <span
              className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
              aria-hidden
            />
            계산 중…
          </>
        ) : (
          `${yearMonth} 정산 재계산`
        )}
      </button>
      {message && (
        <span className={`text-[11px] ${message.ok ? 'text-emerald-700' : 'text-red-600'} break-keep sm:text-right`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
