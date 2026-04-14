'use client';

import { useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import OrgTreeNode, {
  type ContractItem,
  collectSubtreeIds,
  countCompleted,
} from './OrgTreeNode';
import styles from './org-tree.module.css';

// ── 유틸 ─────────────────────────────────────────────────
function findNode(nodes: OrgTreeNodeType[], id: string): OrgTreeNodeType | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

function collectSubtreeContracts(
  node: OrgTreeNodeType,
  map: Record<string, ContractItem[]>,
): ContractItem[] {
  return collectSubtreeIds(node)
    .flatMap((id) => map[id] ?? [])
    .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));
}

// ── 상태 색상 ─────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  준비: 'text-gray-400', 대기: 'text-yellow-500', 상담중: 'text-blue-400',
  가입: 'text-indigo-400', 해피콜완료: 'text-cyan-600', 배송준비: 'text-purple-500',
  배송완료: 'text-teal-600', 정산완료: 'text-green-600', 취소: 'text-red-400', 해약: 'text-red-600',
};

const COMPLETED = new Set(['가입']);

// ── 계약 패널 ─────────────────────────────────────────────
function ContractPanel({
  node,
  contracts,
  onClose,
}: {
  node: OrgTreeNodeType;
  contracts: ContractItem[];
  onClose: () => void;
}) {
  const completedCount = contracts.filter((c) => COMPLETED.has(c.status)).length;

  return (
    <div className="mt-6 border-t-2 border-gray-200 pt-4">
      {/* 헤더 */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="font-bold text-gray-800 text-sm">{node.name}</span>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {node.rank}
        </span>
        <span className="text-xs text-gray-500 ml-1">산하 전체 {contracts.length}건</span>
        {completedCount > 0 && (
          <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            완료 {completedCount}건
          </span>
        )}
        <button
          onClick={onClose}
          className="ml-auto text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
        >
          닫기 ✕
        </button>
      </div>

      {contracts.length === 0 ? (
        <p className="text-xs text-gray-400 px-1 py-4 text-center">산하 계약 없음</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
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
                    {c.status}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.unit_count ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap tabular-nums">
                    {c.join_date?.slice(0, 10) ?? '-'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 font-mono whitespace-nowrap">{c.contract_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 메인 ─────────────────────────────────────────────────
interface Props {
  roots: OrgTreeNodeType[];
  contractsByMember: Record<string, ContractItem[]>;
}

export default function OrgTree({ roots, contractsByMember }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedNode = selectedId ? findNode(roots, selectedId) : null;
  const selectedContracts = selectedNode
    ? collectSubtreeContracts(selectedNode, contractsByMember)
    : [];

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  if (roots.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        조직 데이터가 없습니다.
        <br />
        <span className="text-xs">TY Life 동기화 버튼으로 데이터를 가져오세요.</span>
      </div>
    );
  }

  return (
    <div>
      {/* 피라미드 트리 (가로 스크롤 허용) */}
      <div className="overflow-x-auto pb-4">
        <div className={styles.branch} style={{ minWidth: 'max-content', padding: '4px 24px 0' }}>
          {roots.map((root) => (
            <div key={root.id} className={styles.branchNode}>
              <OrgTreeNode
                node={root}
                depth={0}
                contractsByMember={contractsByMember}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 선택된 멤버의 산하 계약 패널 */}
      {selectedNode && (
        <ContractPanel
          node={selectedNode}
          contracts={selectedContracts}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
