'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatKRW } from '@/lib/settlement/calculator';

const SELF_CONTRACT_COMMISSION_PER_UNIT_WON = 300_000;

export type SettlementLineRow = {
  topLineId: string;
  topDisplayName: string;
  topRank: string;
  base: number;
  rollup: number;
  leaderMaint: number;
  total: number;
  directContractCount: number;
  directUnitSum: number;
  ownDirectUnitSum: number;
};

export default function SettlementLineTableClient(props: {
  yearMonth: string;
  todayYearMonth: string;
  startDate: string;
  endDate: string;
  totalSales: number;
  periodSales: number;
  selfIncludedInitialByTopId: Record<string, boolean>;
  rows: SettlementLineRow[];
}) {
  const [selfIncludedByTopId, setSelfIncludedByTopId] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const r of props.rows) {
      next[r.topLineId] = props.selfIncludedInitialByTopId[r.topLineId] ?? true;
    }
    setSelfIncludedByTopId(next);
    setSaveError(null);
    // yearMonth/rows 바뀌면 다시 로드
  }, [props.yearMonth, props.rows, props.selfIncludedInitialByTopId]);

  const { adjustedTotalAmount, adjustedProfit, adjustedRows, excludedUnitsTotal } = useMemo(() => {
    let excludedUnits = 0;
    const rows = props.rows.map((r) => {
      const included = selfIncludedByTopId[r.topLineId] ?? true;
      const adjustWon = included ? 0 : r.ownDirectUnitSum * SELF_CONTRACT_COMMISSION_PER_UNIT_WON;
      if (!included) excludedUnits += r.ownDirectUnitSum;
      return {
        ...r,
        selfContractIncluded: included,
        selfContractAdjustWon: adjustWon,
        adjustedTotal: r.total - adjustWon,
      };
    });
    const baseTotal = rows.reduce((s, r) => s + (r.total ?? 0), 0);
    const adjusted = rows.reduce((s, r) => s + (r.adjustedTotal ?? 0), 0);
    return {
      excludedUnitsTotal: excludedUnits,
      adjustedTotalAmount: adjusted,
      adjustedProfit: props.periodSales - adjusted,
      adjustedRows: rows,
      baseTotalAmount: baseTotal,
    };
  }, [props.rows, props.periodSales, selfIncludedByTopId]);

  const baseSum = useMemo(() => props.rows.reduce((s, r) => s + (r.base ?? 0), 0), [props.rows]);
  const rollupSum = useMemo(() => props.rows.reduce((s, r) => s + (r.rollup ?? 0), 0), [props.rows]);
  const leaderMaintSum = useMemo(() => props.rows.reduce((s, r) => s + (r.leaderMaint ?? 0), 0), [props.rows]);

  return (
    <>
      <div className="text-sm text-gray-500 mt-0.5">
        {props.yearMonth} · 합계 {formatKRW(adjustedTotalAmount)}
        {excludedUnitsTotal > 0 && (
          <span className="ml-2 text-xs text-amber-700">
            (본인계약 미인정 {excludedUnitsTotal.toLocaleString('ko-KR')}구좌 · -{formatKRW(excludedUnitsTotal * SELF_CONTRACT_COMMISSION_PER_UNIT_WON)})
          </span>
        )}
        {saveError && (
          <span className="ml-2 text-xs text-red-600">
            (저장 실패: {saveError})
          </span>
        )}
      </div>

      {/* KPI (오른쪽) */}
      <div className="hidden md:grid grid-cols-3 gap-2">
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
          <div className="text-[11px] text-gray-500">총 매출</div>
          <div className="font-bold text-gray-800 tabular-nums">{formatKRW(props.totalSales)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
          <div className="text-[11px] text-gray-500">이번달 매출</div>
          <div className="font-bold text-gray-800 tabular-nums">{formatKRW(props.periodSales)}</div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            기준 {props.startDate}~{props.endDate}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm shadow-sm">
          <div className="text-[11px] text-gray-500">수익</div>
          <div className={`font-bold tabular-nums ${adjustedProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
            {formatKRW(adjustedProfit)}
          </div>
          <div className="text-[10px] text-gray-400 mt-0.5">
            이번달 매출 - 정산금 합계
          </div>
        </div>
      </div>

      {/* 정산 테이블 */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mt-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  '담당자',
                  '직급',
                  '리더(정책)',
                  '적용 단가',
                  '직접계약',
                  '직접구좌',
                  '산하구좌',
                  '기본수당',
                  '롤업수당',
                  '유지장려(리더)',
                  '본인계약 인정',
                  '합계',
                  '확정',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold text-gray-600 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {adjustedRows.map((r) => (
                <tr key={r.topLineId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/settlement/member?year_month=${props.yearMonth}&member_id=${r.topLineId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {r.topDisplayName || '-'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.topRank}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">-</td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px] whitespace-normal">라인 합계</td>
                  <td className="px-4 py-3 tabular-nums text-right">{r.directContractCount.toLocaleString()}건</td>
                  <td className="px-4 py-3 tabular-nums text-right">{r.directUnitSum.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums text-right">-</td>
                  <td className="px-4 py-3 tabular-nums text-right text-gray-700">{formatKRW(r.base)}</td>
                  <td className="px-4 py-3 tabular-nums text-right text-gray-700">{formatKRW(r.rollup)}</td>
                  <td className="px-4 py-3 tabular-nums text-right text-violet-700">{formatKRW(r.leaderMaint)}</td>
                  <td className="px-4 py-3 text-xs text-gray-700 whitespace-nowrap">
                    <label className={`inline-flex items-center gap-2 select-none ${r.ownDirectUnitSum > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                      <input
                        type="checkbox"
                        checked={r.selfContractIncluded}
                        disabled={r.ownDirectUnitSum <= 0}
                        onChange={(e) => {
                          if (r.ownDirectUnitSum <= 0) return;
                          const nextVal = e.target.checked;
                          setSaveError(null);
                          setSelfIncludedByTopId((prev) => {
                            const next = { ...prev, [r.topLineId]: nextVal };
                            return next;
                          });

                          // DB 저장 (월/라인 단위)
                          fetch('/api/settlement/self-contract-preferences', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              year_month: props.yearMonth,
                              top_line_id: r.topLineId,
                              included: nextVal,
                            }),
                          })
                            .then(async (res) => {
                              const json = (await res.json()) as any;
                              if (!res.ok || !json?.success) {
                                throw new Error(json?.error ?? `HTTP ${res.status}`);
                              }
                            })
                            .catch((err) => {
                              // 실패 시 롤백
                              setSelfIncludedByTopId((prev) => ({ ...prev, [r.topLineId]: !nextVal }));
                              setSaveError(err instanceof Error ? err.message : String(err));
                            });
                        }}
                      />
                      <span className={r.selfContractIncluded ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                        {r.selfContractIncluded ? '인정' : '미인정'}
                      </span>
                      {!r.selfContractIncluded && r.ownDirectUnitSum > 0 && (
                        <span className="text-[11px] text-amber-700">
                          (-{formatKRW(r.selfContractAdjustWon)})
                        </span>
                      )}
                    </label>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-right font-bold text-gray-900">
                    {formatKRW(r.adjustedTotal)}
                  </td>
                  <td className="px-4 py-3 text-center">-</td>
                </tr>
              ))}
            </tbody>

            <tfoot className="border-t-2 border-gray-200 bg-gray-50">
              <tr>
                <td colSpan={8} className="px-4 py-3 font-semibold text-gray-700">
                  합계
                </td>
                <td className="px-4 py-3 tabular-nums text-right font-semibold">
                  {formatKRW(baseSum)}
                </td>
                <td className="px-4 py-3 tabular-nums text-right font-semibold">
                  {formatKRW(rollupSum)}
                </td>
                <td className="px-4 py-3 tabular-nums text-right font-semibold text-violet-700">
                  {formatKRW(leaderMaintSum)}
                </td>
                <td className="px-4 py-3 tabular-nums text-right font-bold text-gray-900">
                  {formatKRW(adjustedTotalAmount)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}

