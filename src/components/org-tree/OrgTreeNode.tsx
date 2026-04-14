'use client';

import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';

// ── 타입 ─────────────────────────────────────────────────
export interface ContractItem {
  id: string;
  contract_code: string;
  join_date: string | null;
  product_type: string | null;
  item_name?: string | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
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

function isJoinCompleted(c: ContractItem): boolean {
  if (c.status === '가입') return true;
  const hasRental = (c.rental_request_no ?? '').trim().length > 0;
  const hasInvoice = (c.invoice_no ?? '').trim().length > 0;
  return c.status !== '해약' && hasRental && hasInvoice;
}
const CARD_STATUSES = ['준비', '대기', '해약', '가입'] as const;
type CardStatus = (typeof CARD_STATUSES)[number];

export function countCompleted(ids: string[], map: Record<string, ContractItem[]>): number {
  return ids.reduce(
    (sum, id) => sum + (map[id] ?? []).filter(isJoinCompleted).length,
    0,
  );
}

export function countByStatus(
  ids: string[],
  map: Record<string, ContractItem[]>,
): Record<CardStatus, number> {
  const counts: Record<CardStatus, number> = { 준비: 0, 대기: 0, 해약: 0, 가입: 0 };
  for (const id of ids) {
    for (const c of map[id] ?? []) {
      const bucket: CardStatus =
        isJoinCompleted(c) ? '가입' : ((c.status as CardStatus) in counts ? (c.status as CardStatus) : '준비');
      counts[bucket] += 1;
    }
  }
  return counts;
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
  const counts = countByStatus(subtreeIds, contractsByMember);

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
      </div>
    </div>
  );
}
