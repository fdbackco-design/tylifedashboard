'use client';

/**
 * 영업자별 지급명세서 게이트 클라이언트.
 *
 * - URL 의 {tyCode} 와 사용자가 입력한 코드가 일치할 때만 /api/public/settlement-sheet 호출
 *   → 응답 데이터로 명세서 렌더.
 * - 코드 불일치 시 서버에서 401 응답하고, 페이지에서 "전산코드가 일치하지 않습니다." 표시.
 * - 페이지 초기 렌더에는 명세서 데이터가 포함되지 않는다 (HTML 페이로드 노출 방지).
 */

import { useState } from 'react';
import StatementSheetView, { type StatementSheetViewProps } from './StatementSheetView';

interface ApiSuccess {
  ok: true;
  yearMonthLabelKo: string;
  displayWindowKo: string;
  sheet: {
    name: string;
    rank: StatementSheetViewProps['rank'];
    yearMonth: string;
    personalUnitCount: number;
    downlineUnitCount: number;
    totalUnitCount: number;
    personalCommission: number;
    overrideAmount: number;
    bonusAmount: number;
    grossTotal: number;
    withholdingTax: number;
    netPayment: number;
  };
}

interface ApiError {
  ok?: false;
  error: string;
}

export default function StatementSheetGateClient({
  tyCode,
  yearMonth,
}: {
  tyCode: string;
  yearMonth: string;
}) {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [data, setData] = useState<ApiSuccess | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);
    setData(null);
    const trimmed = input.trim();
    if (!trimmed) {
      setErrorMessage('전산코드를 입력해주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/public/settlement-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tyCode, year_month: yearMonth, code: trimmed }),
        cache: 'no-store',
      });
      const json = (await res.json()) as ApiSuccess | ApiError;
      if (!res.ok || !('ok' in json) || !json.ok) {
        const code = (json as ApiError).error;
        if (code === 'code_mismatch') {
          setErrorMessage('전산코드가 일치하지 않습니다.');
        } else if (code === 'member_not_found') {
          setErrorMessage('해당 전산코드에 대응하는 영업자를 찾을 수 없습니다.');
        } else if (code === 'invalid_year_month') {
          setErrorMessage('정산월 형식이 올바르지 않습니다.');
        } else {
          setErrorMessage('명세서를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
        return;
      }
      setData(json);
    } catch {
      setErrorMessage('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  if (data) {
    return (
      <StatementSheetView
        name={data.sheet.name}
        rank={data.sheet.rank}
        yearMonthLabelKo={data.yearMonthLabelKo}
        displayWindowKo={data.displayWindowKo}
        personalUnitCount={data.sheet.personalUnitCount}
        downlineUnitCount={data.sheet.downlineUnitCount}
        totalUnitCount={data.sheet.totalUnitCount}
        personalCommission={data.sheet.personalCommission}
        overrideAmount={data.sheet.overrideAmount}
        bonusAmount={data.sheet.bonusAmount}
        grossTotal={data.sheet.grossTotal}
        withholdingTax={data.sheet.withholdingTax}
        netPayment={data.sheet.netPayment}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
        지급 명세서 확인
      </h1>
      <p className="mt-2 text-xs leading-relaxed text-slate-500 sm:text-sm">
        본인 확인을 위해 TY 전산코드를 입력해주세요. 입력하신 코드가 일치하는 경우에만 지급
        명세서가 표시됩니다.
      </p>
      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <div>
          <label htmlFor="ty-code-input" className="block text-xs font-medium text-slate-700">
            TY 전산코드
          </label>
          <input
            id="ty-code-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="예) TY12345"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tracking-wide text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
            disabled={submitting}
          />
        </div>
        {errorMessage ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
            {errorMessage}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-gradient-to-b from-orange-500 to-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm ring-1 ring-orange-400/40 transition hover:from-orange-600 hover:to-orange-700 disabled:opacity-60"
        >
          {submitting ? '확인 중…' : '명세서 보기'}
        </button>
      </form>
    </div>
  );
}
