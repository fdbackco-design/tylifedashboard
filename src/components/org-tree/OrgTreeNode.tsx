'use client';

import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import {
  type ContractItem,
  collectSubtreeIds,
  countByStatus,
  sumJoinUnits,
} from '@/lib/organization/org-tree-contract-counts';

export * from '@/lib/organization/org-tree-contract-counts';

// ── 직급별 스타일 ─────────────────────────────────────────
const RANK_STYLE: Record<string, { badge: string; border: string }> = {
  본사:       { badge: 'bg-slate-800 text-white',  border: 'border-slate-600' },
  사업본부장: { badge: 'bg-violet-700 text-white', border: 'border-violet-400' },
  센터장:     { badge: 'bg-indigo-600 text-white', border: 'border-indigo-400' },
  리더:       { badge: 'bg-blue-500 text-white',   border: 'border-blue-400'   },
  영업사원:   { badge: 'bg-sky-200 text-sky-800',  border: 'border-sky-300'    },
};

// ── 카드 컴포넌트 ─────────────────────────────────────────
interface Props {
  node: OrgTreeNodeType;
  contractsByMember: Record<string, ContractItem[]>;
  extraSubtreeIds?: string[];
  showMetrics?: boolean;
  /** showMetrics일 때 인정수당·실지급액 표시. false면 누적/월 구좌만 */
  showCommissionMetrics?: boolean;
  showForecast?: boolean;
  /**
   * showForecast 시 게이지/남은 구좌 계산에 사용할 "이번 달 목표 구좌".
   * 미지정 시 기존 동작 그대로(20)로 폴백한다. 정산/집계 로직에는 영향 없음.
   */
  goalUnits?: number;
  nodeMetrics: null | {
    cumulativeUnitCount: number;
    monthlyUnitCount: number;
    recognizedCommissionWon: number;
    paidCommissionWon: number;
  };
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * 검색에서 포커싱된 노드를 일시적으로 강조 표시한다.
   * - 화면 중앙으로 이동된 직후 시각적으로 식별할 수 있게 ring/배경 강조를 더한다.
   */
  isHighlighted?: boolean;
}

export type OrgTreeNodeProps = Props;

function formatManwon(won: number): string {
  // 표시 단위: 만원 (예: 900,000원 -> 90)
  const v = Math.round(won / 10_000);
  return v.toLocaleString('ko-KR');
}

export default function OrgTreeNode({
  node,
  contractsByMember,
  extraSubtreeIds,
  showMetrics = true,
  showCommissionMetrics = true,
  showForecast = false,
  goalUnits,
  nodeMetrics,
  selectedId,
  onSelect,
  isHighlighted = false,
}: Props) {
  const isSelected = selectedId === node.id;
  const style = RANK_STYLE[node.rank] ?? RANK_STYLE['영업사원'];
  const displayName = (node.name ?? '').replace(/^\[고객\]\s*/, '');

  const subtreeIds = [...new Set([...collectSubtreeIds(node), ...(extraSubtreeIds ?? [])])];
  const counts = countByStatus(subtreeIds, contractsByMember);
  const joinUnits = showForecast ? sumJoinUnits(subtreeIds, contractsByMember) : 0;
  // 본인이 설정한 목표 구좌(monthly_target_units)를 prop 으로 받아 사용. 미지정 시 기본 20.
  const effectiveGoalUnits =
    typeof goalUnits === 'number' && Number.isFinite(goalUnits) && goalUnits > 0 ? goalUnits : 20;
  const progressPct = showForecast ? Math.max(0, Math.min(100, Math.round((joinUnits / effectiveGoalUnits) * 100))) : 0;
  const remainingUnits = showForecast ? Math.max(0, effectiveGoalUnits - joinUnits) : 0;

  return (
    <div
      onClick={() => onSelect(node.id)}
      data-org-node-card="1"
      data-org-member-id={node.id}
      data-org-member-name={displayName}
      className={`
        touch-none min-w-[130px] max-w-[180px] rounded-xl border-2 bg-white shadow-sm
        cursor-pointer select-none transition-all
        ${style.border}
        ${isHighlighted
          ? 'ring-4 ring-offset-2 ring-amber-400 bg-amber-50 shadow-lg'
          : isSelected
            ? 'ring-2 ring-offset-2 ring-indigo-400 shadow-md'
            : 'hover:shadow-md hover:-translate-y-0.5'}
      `}
    >
      <div className="px-3 py-3 flex flex-col items-center gap-1.5 text-center">
        {/* 직급 뱃지 */}
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
          {node.rank}
        </span>

        {/* 이름 */}
        <span className="text-sm font-bold text-gray-800 leading-snug">
          {displayName}
        </span>

        {/* 가입 건수 */}
        <div className="flex flex-wrap justify-center gap-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
            준비 {counts.준비}건
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
            대기 {counts.대기}건
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
            해약 {counts.해약}건
          </span>
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              counts.가입 > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
            }`}
          >
            가입 {counts.가입}건
          </span>
        </div>

        {showForecast && node.rank !== '본사' ? (
          <div className="mt-1.5 w-full text-[11px] text-gray-600 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500 whitespace-nowrap">월 구좌</span>
              <span className="font-semibold text-gray-800 tabular-nums whitespace-nowrap">
                {joinUnits.toLocaleString('ko-KR')}구좌
              </span>
            </div>
            {nodeMetrics ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500 whitespace-nowrap">누적 구좌</span>
                <span className="font-semibold text-gray-800 tabular-nums whitespace-nowrap">
                  {nodeMetrics.cumulativeUnitCount.toLocaleString('ko-KR')}구좌
                </span>
              </div>
            ) : null}
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="text-gray-500">
              목표까지 남은 구좌 <span className="font-semibold text-gray-800 tabular-nums">{remainingUnits.toLocaleString('ko-KR')}</span>
            </div>
          </div>
        ) : null}

        {showMetrics && nodeMetrics && node.rank !== '본사' && (
          <div className="mt-1.5 w-full text-[11px] text-gray-600 space-y-0.5">
            <div className="flex justify-between">
              <span className="text-gray-500">누적 구좌</span>
              <span className="font-semibold text-gray-800 tabular-nums">
                {nodeMetrics.cumulativeUnitCount.toLocaleString('ko-KR')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">월 구좌</span>
              <span className="font-semibold text-gray-800 tabular-nums">
                {nodeMetrics.monthlyUnitCount.toLocaleString('ko-KR')}
              </span>
            </div>
            {showCommissionMetrics ? (
              <>
                <div className="flex justify-between">
                  <span className="text-gray-500">인정수당</span>
                  <span className="font-semibold text-gray-800 tabular-nums">
                    {formatManwon(nodeMetrics.recognizedCommissionWon)}만원
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">실지급액</span>
                  <span className="font-semibold text-gray-800 tabular-nums">
                    {formatManwon(nodeMetrics.paidCommissionWon)}만원
                  </span>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
