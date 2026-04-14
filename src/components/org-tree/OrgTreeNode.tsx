'use client';

import { useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';

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
const RANK_STYLE: Record<string, { badge: string; border: string; dot: string }> = {
  본사:      { badge: 'bg-slate-800 text-white',   border: 'border-slate-800', dot: 'bg-slate-800' },
  사업본부장: { badge: 'bg-violet-700 text-white',  border: 'border-violet-500', dot: 'bg-violet-500' },
  센터장:    { badge: 'bg-indigo-600 text-white',  border: 'border-indigo-400', dot: 'bg-indigo-400' },
  리더:      { badge: 'bg-blue-500 text-white',    border: 'border-blue-400',   dot: 'bg-blue-400' },
  영업사원:  { badge: 'bg-sky-200 text-sky-800',   border: 'border-sky-300',    dot: 'bg-sky-300' },
};

const STATUS_LABEL: Record<string, string> = {
  준비: '준비', 대기: '대기', 상담중: '상담중', 가입: '가입',
  해피콜완료: '해피콜완료', 배송준비: '배송준비', 배송완료: '배송완료',
  정산완료: '정산완료', 취소: '취소', 해약: '해약',
};
const STATUS_COLOR: Record<string, string> = {
  준비: 'text-gray-400', 대기: 'text-yellow-500', 상담중: 'text-blue-400',
  가입: 'text-indigo-400', 해피콜완료: 'text-cyan-500', 배송준비: 'text-purple-500',
  배송완료: 'text-teal-500', 정산완료: 'text-green-600', 취소: 'text-red-400', 해약: 'text-red-600',
};

const COMPLETED = new Set(['해피콜완료', '배송준비', '배송완료', '정산완료']);

// ── 서브트리 유틸 ─────────────────────────────────────────
function collectSubtreeIds(node: OrgTreeNodeType): string[] {
  return [node.id, ...node.children.flatMap(collectSubtreeIds)];
}

function countCompleted(ids: string[], map: Record<string, ContractItem[]>): number {
  return ids.reduce((sum, id) => {
    return sum + (map[id] ?? []).filter((c) => COMPLETED.has(c.status)).length;
  }, 0);
}

// ── 날짜 포맷 ─────────────────────────────────────────────
function fmtDate(d: string | null) {
  if (!d) return '-';
  return d.slice(0, 10);
}

// ── 계약 패널 ─────────────────────────────────────────────
function ContractPanel({ contracts }: { contracts: ContractItem[] }) {
  if (contracts.length === 0) {
    return <p className="px-4 py-3 text-xs text-gray-400">산하 계약 없음</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {['고객명', '상품', '상태', '구좌', '가입일', '계약코드'].map((h) => (
              <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {contracts.map((c) => (
            <tr key={c.id} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{c.customer_name}</td>
              <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{c.product_type ?? '-'}</td>
              <td className={`px-3 py-2 font-semibold whitespace-nowrap ${STATUS_COLOR[c.status] ?? 'text-gray-500'}`}>
                {STATUS_LABEL[c.status] ?? c.status}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{c.unit_count ?? '-'}</td>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap tabular-nums">{fmtDate(c.join_date)}</td>
              <td className="px-3 py-2 text-gray-400 font-mono whitespace-nowrap">{c.contract_code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 메인 노드 ─────────────────────────────────────────────
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
  const subtreeContracts = subtreeIds
    .flatMap((id) => contractsByMember[id] ?? [])
    .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));

  return (
    <div className="relative">
      {/* 세로 연결선 (depth > 0) */}
      {depth > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 border-l-2 border-gray-200"
          style={{ left: `${(depth - 1) * 24 + 12}px` }}
        />
      )}

      {/* 카드 */}
      <div style={{ paddingLeft: `${depth * 24}px` }} className="relative">
        {/* 가로 연결선 */}
        {depth > 0 && (
          <div
            className="absolute border-t-2 border-gray-200"
            style={{ left: `${(depth - 1) * 24 + 12}px`, top: '20px', width: '16px' }}
          />
        )}

        <div
          className={`
            relative mb-1.5 rounded-xl border-2 shadow-sm transition-all
            ${style.border}
            ${isSelected ? 'ring-2 ring-offset-1 ring-indigo-400 shadow-md' : 'hover:shadow-md'}
            bg-white
          `}
        >
          {/* 카드 헤더 */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            {/* 직급 뱃지 */}
            <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${style.badge}`}>
              {node.rank}
            </span>

            {/* 이름 (클릭 → 계약 패널) */}
            <button
              className="flex-1 text-left text-sm font-bold text-gray-800 hover:text-indigo-700 truncate"
              onClick={() => onSelect(node.id)}
            >
              {node.name}
            </button>

            {/* 산하 완료 건수 */}
            <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
              subtreeCompleted > 0
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-400'
            }`}>
              완료 {subtreeCompleted}건
            </span>

            {/* 자식 토글 */}
            {hasChildren && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 text-xs"
              >
                {expanded ? '▾' : '▸'}
              </button>
            )}
          </div>

          {/* 계약 패널 (선택 시) */}
          {isSelected && (
            <div className="border-t border-gray-100">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50">
                <span className="text-xs font-semibold text-gray-600">
                  산하 계약 전체 ({subtreeContracts.length}건)
                </span>
                <span className="text-xs text-green-600 font-semibold">
                  완료 {subtreeCompleted}건
                </span>
              </div>
              <ContractPanel contracts={subtreeContracts} />
            </div>
          )}
        </div>
      </div>

      {/* 하위 노드 */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <OrgTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              contractsByMember={contractsByMember}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
