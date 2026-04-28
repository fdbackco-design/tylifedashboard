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
  splitOpenInitialByTopId: Record<string, boolean>;
  rows: SettlementLineRow[];
  /**
   * Preview: 산하 분리 보기용 데이터
   * - childrenByParent: 화면 트리(treeRows) 기준의 parent -> direct children
   * - memberAggById: 월정산 결과(기존 계산)에서 멤버별 금액/직접구좌를 그대로 전달
   * - topLineIdByMemberId: 멤버가 속한 본사 직속 최상위 라인 id
   */
  childrenByParent: Record<string, string[]>;
  memberAggById: Record<
    string,
    {
      memberId: string;
      displayName: string;
      rank: string;
      base: number;
      rollup: number;
      leaderMaint: number;
      total: number;
      directContractCount: number;
      directUnitSum: number;
    }
  >;
  topLineIdByMemberId: Record<string, string>;
}) {
  const [selfIncludedByTopId, setSelfIncludedByTopId] = useState<Record<string, boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [splitOpenByTopId, setSplitOpenByTopId] = useState<Record<string, boolean>>({});
  const [splitSaveError, setSplitSaveError] = useState<string | null>(null);

  useEffect(() => {
    // 초기값은 DB에서 내려온 맵을 우선 사용 (행이 분리되어도 child id에 대한 설정이 바로 반영될 수 있게)
    setSelfIncludedByTopId(props.selfIncludedInitialByTopId ?? {});
    setSaveError(null);
    // yearMonth/rows 바뀌면 다시 로드
  }, [props.yearMonth, props.rows, props.selfIncludedInitialByTopId]);

  useEffect(() => {
    // 초기값은 DB에서 내려온 맵을 우선 사용 (행이 분리되어도 child id에 대한 설정이 바로 반영될 수 있게)
    setSplitOpenByTopId(props.splitOpenInitialByTopId ?? {});
    setSplitSaveError(null);
  }, [props.yearMonth, props.rows, props.splitOpenInitialByTopId]);

  const { adjustedTotalAmount, adjustedProfit, adjustedRows, excludedUnitsTotal } = useMemo(() => {
    const collectSubtree = (rootId: string): Set<string> => {
      const out = new Set<string>();
      const stack = [rootId];
      while (stack.length) {
        const cur = stack.pop()!;
        if (out.has(cur)) continue;
        out.add(cur);
        for (const ch of props.childrenByParent[cur] ?? []) stack.push(ch);
      }
      return out;
    };

    const sumAgg = (memberIds: Set<string>) => {
      let base = 0;
      let rollup = 0;
      let leaderMaint = 0;
      let total = 0;
      let directContractCount = 0;
      let directUnitSum = 0;
      for (const id of memberIds) {
        const m = props.memberAggById[id];
        if (!m) continue;
        base += m.base ?? 0;
        rollup += m.rollup ?? 0;
        leaderMaint += m.leaderMaint ?? 0;
        total += m.total ?? 0;
        directContractCount += m.directContractCount ?? 0;
        directUnitSum += m.directUnitSum ?? 0;
      }
      return { base, rollup, leaderMaint, total, directContractCount, directUnitSum };
    };

    // 산하 분리 보기: 행 재구성(재귀)
    // - split 상태인 노드는 "본인만" + "직계 자식 subtree 행들"로 펼친다.
    // - split 상태가 아니면 해당 노드 subtree를 1행으로 보여준다.
    type ExpandedRow = SettlementLineRow & { __anchorTopLineId: string; __depth: number };

    const buildRowForSubtree = (nodeId: string, anchorTopLineId: string, depth: number): ExpandedRow | null => {
      const subtree = collectSubtree(nodeId);
      const inLine = new Set<string>();
      for (const mid of subtree) {
        if ((props.topLineIdByMemberId[mid] ?? null) === anchorTopLineId) inLine.add(mid);
      }
      if (inLine.size === 0) return null;
      const agg = sumAgg(inLine);
      const meta = props.memberAggById[nodeId] ?? null;
      return {
        topLineId: nodeId,
        topDisplayName: meta?.displayName ?? nodeId,
        topRank: meta?.rank ?? '-',
        base: agg.base,
        rollup: agg.rollup,
        leaderMaint: agg.leaderMaint,
        total: agg.total,
        directContractCount: agg.directContractCount,
        directUnitSum: agg.directUnitSum,
        ownDirectUnitSum: meta?.directUnitSum ?? 0,
        __anchorTopLineId: anchorTopLineId,
        __depth: depth,
      };
    };

    const buildRowForSelfOnly = (nodeId: string, anchorTopLineId: string, depth: number): ExpandedRow | null => {
      const meta = props.memberAggById[nodeId] ?? null;
      if (!meta) return null;
      // self-only는 "본인 1명"의 기존 월정산 결과(기본/롤업/유지장려/합계)를 그대로 보여준다.
      // (요구: 롤업/유지장려는 기존 결과 유지. base 역시 기존 계산값을 사용)
      return {
        topLineId: nodeId,
        topDisplayName: meta.displayName ?? nodeId,
        topRank: meta.rank ?? '-',
        base: meta.base,
        rollup: meta.rollup,
        leaderMaint: meta.leaderMaint,
        total: meta.total,
        directContractCount: meta.directContractCount,
        directUnitSum: meta.directUnitSum,
        ownDirectUnitSum: meta.directUnitSum,
        __anchorTopLineId: anchorTopLineId,
        __depth: depth,
      };
    };

    const expandNode = (nodeId: string, anchorTopLineId: string, depth: number): ExpandedRow[] => {
      const isSplit = (splitOpenByTopId[nodeId] ?? false) as boolean;
      if (!isSplit) {
        const row = buildRowForSubtree(nodeId, anchorTopLineId, depth);
        return row ? [row] : [];
      }

      const out: ExpandedRow[] = [];
      const selfRow = buildRowForSelfOnly(nodeId, anchorTopLineId, depth);
      if (selfRow) out.push(selfRow);

      const directChildren = props.childrenByParent[nodeId] ?? [];
      for (const childId of directChildren) {
        // 같은 라인(anchor)에 속한 subtree만 보여준다.
        out.push(...expandNode(childId, anchorTopLineId, depth + 1));
      }
      return out;
    };

    const expandedRowsBase: ExpandedRow[] = [];
    for (const top of props.rows) {
      const anchorTopLineId = top.topLineId;
      expandedRowsBase.push(...expandNode(anchorTopLineId, anchorTopLineId, 0));
    }

    let excludedUnits = 0;
    const rows = expandedRowsBase.map((r) => {
      const included = selfIncludedByTopId[r.topLineId] ?? true;
      const adjustWon = included ? 0 : (r.ownDirectUnitSum ?? 0) * SELF_CONTRACT_COMMISSION_PER_UNIT_WON;
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
  }, [
    props.rows,
    props.periodSales,
    selfIncludedByTopId,
    splitOpenByTopId,
    props.childrenByParent,
    props.memberAggById,
    props.topLineIdByMemberId,
  ]);

  const baseSum = useMemo(() => adjustedRows.reduce((s, r) => s + (r.base ?? 0), 0), [adjustedRows]);
  const rollupSum = useMemo(() => adjustedRows.reduce((s, r) => s + (r.rollup ?? 0), 0), [adjustedRows]);
  const leaderMaintSum = useMemo(() => adjustedRows.reduce((s, r) => s + (r.leaderMaint ?? 0), 0), [adjustedRows]);

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
        {splitSaveError && (
          <span className="ml-2 text-xs text-red-600">
            (산하 분리 저장 실패: {splitSaveError})
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
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/settlement/member?year_month=${props.yearMonth}&member_id=${r.topLineId}`}
                        className="text-blue-600 hover:underline"
                      >
                        <span
                          className="inline-flex items-center"
                          style={{
                            paddingLeft: `${Math.min(5, (r.__depth ?? 0) as number) * 14}px`,
                          }}
                        >
                          {(r.__depth ?? 0) > 0 && (
                            <span className="mr-1 text-gray-400" aria-hidden="true">
                              ↳
                            </span>
                          )}
                          {r.topDisplayName || '-'}
                        </span>
                      </Link>
                      {/* 산하 분리(Preview): 현재 행(노드)이 직계 자식이 있으면 언제든 분리 가능(재귀) */}
                      {(() => {
                        const hasChildren = (props.childrenByParent[r.topLineId] ?? []).length > 0;
                        // 월정산 결과에 존재하는 노드만(표시 가능한 노드만) 버튼 노출
                        const hasMeta = !!props.memberAggById[r.topLineId];
                        if (!hasMeta) return null;
                        return (
                          <button
                            type="button"
                            disabled={!hasChildren}
                            onClick={() => {
                              if (!hasChildren) return;
                              const nextVal = !((splitOpenByTopId[r.topLineId] ?? false) as boolean);
                              setSplitSaveError(null);
                              setSplitOpenByTopId((prev) => ({ ...prev, [r.topLineId]: nextVal }));

                              // DB 저장 (월/라인 단위)
                              fetch('/api/settlement/line-split-preferences', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  year_month: props.yearMonth,
                                  top_line_id: r.topLineId,
                                  is_split: nextVal,
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
                                  setSplitOpenByTopId((prev) => ({ ...prev, [r.topLineId]: !nextVal }));
                                  setSplitSaveError(err instanceof Error ? err.message : String(err));
                                });
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] border ${
                              !hasChildren
                                ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                                : (splitOpenByTopId[r.topLineId] ?? false)
                                  ? 'bg-slate-800 text-white border-slate-800'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            {(splitOpenByTopId[r.topLineId] ?? false) ? '산하 합치기' : '산하 분리'}
                          </button>
                        );
                      })()}
                    </div>
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

