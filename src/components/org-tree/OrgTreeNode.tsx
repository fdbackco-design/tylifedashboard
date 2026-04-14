'use client';

import { useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import styles from './org-tree.module.css';

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
  본사:       { badge: 'bg-slate-800 text-white',        border: 'border-slate-700' },
  사업본부장: { badge: 'bg-violet-700 text-white',       border: 'border-violet-400' },
  센터장:     { badge: 'bg-indigo-600 text-white',       border: 'border-indigo-400' },
  리더:       { badge: 'bg-blue-500 text-white',         border: 'border-blue-400'   },
  영업사원:   { badge: 'bg-sky-200 text-sky-800',        border: 'border-sky-300'    },
};

// ── 서브트리 유틸 ─────────────────────────────────────────
export function collectSubtreeIds(node: OrgTreeNodeType): string[] {
  return [node.id, ...node.children.flatMap(collectSubtreeIds)];
}

const COMPLETED = new Set(['해피콜완료', '배송준비', '배송완료', '정산완료']);

export function countCompleted(ids: string[], map: Record<string, ContractItem[]>): number {
  return ids.reduce((sum, id) => sum + (map[id] ?? []).filter((c) => COMPLETED.has(c.status)).length, 0);
}

// ── 노드 컴포넌트 ─────────────────────────────────────────
interface Props {
  node: OrgTreeNodeType;
  depth: number;
  contractsByMember: Record<string, ContractItem[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function OrgTreeNode({ node, depth, contractsByMember, selectedId, onSelect }: Props) {
  const [expanded, setExpanded] = useState(depth < 2);

  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const style = RANK_STYLE[node.rank] ?? RANK_STYLE['영업사원'];
  const subtreeIds = collectSubtreeIds(node);
  const subtreeCompleted = countCompleted(subtreeIds, contractsByMember);

  return (
    <div className="inline-flex flex-col items-center">
      {/* ── 카드 ── */}
      <div
        className={`
          min-w-[140px] max-w-[180px] rounded-xl border-2 bg-white shadow-sm
          transition-all
          ${style.border}
          ${isSelected
            ? 'ring-2 ring-offset-2 ring-indigo-400 shadow-md'
            : 'hover:shadow-md'}
        `}
      >
        {/* 본문 */}
        <div
          className="px-3 py-2.5 flex flex-col items-center gap-1 text-center cursor-pointer select-none"
          onClick={() => onSelect(node.id)}
        >
          {/* 직급 뱃지 */}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
            {node.rank}
          </span>

          {/* 이름 */}
          <span className="text-sm font-bold text-gray-800 leading-snug">
            {node.name}
          </span>

          {/* 산하 완료 건수 */}
          <span
            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              subtreeCompleted > 0
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            완료 {subtreeCompleted}건
          </span>
        </div>

        {/* 접기/펼치기 버튼 */}
        {hasChildren && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full py-1 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 border-t border-gray-100 rounded-b-xl flex items-center justify-center gap-1 transition-colors"
          >
            {expanded ? (
              <span>▲ 접기</span>
            ) : (
              <span>▼ {node.children.length}명</span>
            )}
          </button>
        )}
      </div>

      {/* 카드 → 자식 연결 수직선 */}
      {hasChildren && expanded && (
        <div className="w-0.5 h-6 bg-gray-300 shrink-0" />
      )}

      {/* 자식 노드 가로 나열 */}
      {hasChildren && expanded && (
        <div className={styles.branch}>
          {node.children.map((child) => (
            <div key={child.id} className={styles.branchNode}>
              <OrgTreeNode
                node={child}
                depth={depth + 1}
                contractsByMember={contractsByMember}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
