'use client';

import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';

// ── 타입 ─────────────────────────────────────────────────
export interface ContractItem {
  id: string;
  contract_code: string;
  join_date: string | null;
  product_type: string | null;
  status: string;
  unit_count: number | null;
  customer_name: string;
}

// ── 직급별 스타일 ─────────────────────────────────────────
const RANK_STYLE: Record<string, { badge: string; border: string }> = {
  본사:       { badge: 'bg-slate-800 text-white',  border: 'border-slate-600' },
  사업본부장: { badge: 'bg-violet-700 text-white', border: 'border-violet-400' },
  센터장:     { badge: 'bg-indigo-600 text-white', border: 'border-indigo-400' },
  리더:       { badge: 'bg-blue-500 text-white',   border: 'border-blue-400'   },
  영업사원:   { badge: 'bg-sky-200 text-sky-800',  border: 'border-sky-300'    },
};

// ── 서브트리 유틸 (exported — OrgTree에서도 사용) ─────────
export function collectSubtreeIds(node: OrgTreeNodeType): string[] {
  return [node.id, ...node.children.flatMap(collectSubtreeIds)];
}

const COMPLETED = new Set(['가입']);

export function countCompleted(ids: string[], map: Record<string, ContractItem[]>): number {
  return ids.reduce(
    (sum, id) => sum + (map[id] ?? []).filter((c) => COMPLETED.has(c.status)).length,
    0,
  );
}

// ── 카드 컴포넌트 ─────────────────────────────────────────
interface Props {
  node: OrgTreeNodeType;
  contractsByMember: Record<string, ContractItem[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function OrgTreeNode({ node, contractsByMember, selectedId, onSelect }: Props) {
  const isSelected = selectedId === node.id;
  const style = RANK_STYLE[node.rank] ?? RANK_STYLE['영업사원'];

  const subtreeIds = collectSubtreeIds(node);
  const subtreeCompleted = countCompleted(subtreeIds, contractsByMember);

  return (
    <div
      onClick={() => onSelect(node.id)}
      className={`
        min-w-[130px] max-w-[180px] rounded-xl border-2 bg-white shadow-sm
        cursor-pointer select-none transition-all
        ${style.border}
        ${isSelected
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
          {node.name}
        </span>

        {/* 가입 건수 */}
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            subtreeCompleted > 0
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-100 text-gray-400'
          }`}
        >
          가입 {subtreeCompleted}건
        </span>
      </div>
    </div>
  );
}
