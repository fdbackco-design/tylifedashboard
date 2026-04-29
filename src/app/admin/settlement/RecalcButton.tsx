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
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleRecalc}
        disabled={loading}
        className="px-3 py-2 text-sm rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? '계산 중...' : `${yearMonth} 정산 재계산`}
      </button>
      {message && (
        <span className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-500'}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
