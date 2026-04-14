'use client';

import { useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType, RankType } from '@/lib/types';
import OrgTreeNode, {
  type ContractItem,
  collectSubtreeIds,
} from './OrgTreeNode';

// ── 상수 ─────────────────────────────────────────────────
/** 직급 표시 순서 (위 → 아래) */
const RANK_LEVELS: RankType[] = ['본사', '사업본부장', '센터장', '리더', '영업사원'];

function isJoinCompleted(c: ContractItem): boolean {
  if (c.status === '가입') return true;
  const hasRental = (c.rental_request_no ?? '').trim().length > 0;
  const hasInvoice = (c.invoice_no ?? '').trim().length > 0;
  return c.status !== '해약' && hasRental && hasInvoice;
}

// ── 유틸 ─────────────────────────────────────────────────

/** 재귀 트리 → 평탄 배열 */
function flattenTree(nodes: OrgTreeNodeType[]): OrgTreeNodeType[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** id로 노드 찾기 */
function findNode(nodes: OrgTreeNodeType[], id: string): OrgTreeNodeType | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** 선택된 노드의 산하 계약 전체 수집 */
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
  가입: 'text-green-600', 해피콜완료: 'text-cyan-600', 배송준비: 'text-purple-500',
  배송완료: 'text-teal-600', 정산완료: 'text-green-700', 취소: 'text-red-400', 해약: 'text-red-600',
  '렌탈 미충족': 'text-orange-700',
};

type AggregatedContract = {
  key: string;
  customer_name: string;
  join_date: string | null;
  product_type: string | null;
  item_name: string | null;
  status: string;
  unit_count: number;
  contract_codes: string[];
  show_rental_unmet: boolean;
};

function isRentalUnmet(c: ContractItem): boolean {
  const v = (c.rental_request_no ?? c.memo ?? '').trim();
  return (c.status === '준비' || c.status === '대기') && v === '렌탈기준 미충족';
}

function getDisplayStatus(c: ContractItem): string {
  return isRentalUnmet(c) ? '렌탈 미충족' : c.status;
}

function aggregateContracts(contracts: ContractItem[]): AggregatedContract[] {
  const map = new Map<string, AggregatedContract>();

  for (const c of contracts) {
    const join = c.join_date?.slice(0, 10) ?? '';
    const displayStatus = getDisplayStatus(c);
    // 고객명+가입일이 같더라도 상태가 다르면 다른 행으로 표시
    const key = `${c.customer_name}__${join}__${displayStatus}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        customer_name: c.customer_name,
        join_date: c.join_date,
        product_type: c.product_type ?? null,
        item_name: c.item_name ?? null,
        status: displayStatus,
        unit_count: c.unit_count ?? 0,
        contract_codes: [c.contract_code],
        show_rental_unmet: isRentalUnmet(c),
      });
      continue;
    }

    existing.unit_count += c.unit_count ?? 0;
    if (!existing.item_name && c.item_name) existing.item_name = c.item_name;
    if (isRentalUnmet(c)) existing.show_rental_unmet = true;
    existing.contract_codes.push(c.contract_code);
  }

  return [...map.values()].sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));
}

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
  const aggregated = aggregateContracts(contracts);
  const completedCount = contracts.filter(isJoinCompleted).length;

  return (
    <div className="mt-6 border-t-2 border-gray-200 pt-4">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="font-bold text-gray-800 text-sm">{node.name}</span>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          {node.rank}
        </span>
        <span className="text-xs text-gray-500 ml-1">
          산하 전체 {contracts.length}건 · 묶음 {aggregated.length}건
        </span>
        {completedCount > 0 && (
          <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
            가입 {completedCount}건
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
                {['고객명', '상품', '물품명', '상태', '구좌', '가입일', '계약코드'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aggregated.map((c) => {
                const codes =
                  c.contract_codes.length <= 1
                    ? c.contract_codes[0]
                    : `${c.contract_codes[0]} 외 ${c.contract_codes.length - 1}건`;

                return (
                  <tr key={c.key} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                      {c.customer_name}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {c.product_type ?? '-'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {c.item_name ?? '-'}
                    </td>
                    <td
                      className={`px-3 py-2 font-semibold whitespace-nowrap ${STATUS_COLOR[c.status] ?? 'text-gray-500'}`}
                    >
                      {c.status}
                      {c.show_rental_unmet && c.status !== '렌탈 미충족' && (
                        <span className="ml-1 text-orange-700">(렌탈 미충족)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.unit_count}
                    </td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap tabular-nums">
                      {c.join_date?.slice(0, 10) ?? '-'}
                    </td>
                    <td
                      title={c.contract_codes.join(', ')}
                      className="px-3 py-2 text-gray-400 font-mono whitespace-nowrap"
                    >
                      {codes}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────
interface Props {
  roots: OrgTreeNodeType[];
  contractsByMember: Record<string, ContractItem[]>;
}

export default function OrgTree({ roots, contractsByMember }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 트리를 평탄화해 전체 노드 목록 확보
  const allNodes = flattenTree(roots);

  // rank 기준으로 그룹화
  const byRank = new Map<RankType, OrgTreeNodeType[]>();
  for (const node of allNodes) {
    const rank = node.rank as RankType;
    if (!byRank.has(rank)) byRank.set(rank, []);
    byRank.get(rank)!.push(node);
  }

  // 실제 데이터가 있는 직급 레벨만, RANK_LEVELS 순서대로
  const activeLevels = RANK_LEVELS.filter((r) => byRank.has(r));

  const selectedNode = selectedId ? findNode(roots, selectedId) : null;
  const selectedContracts = selectedNode
    ? collectSubtreeContracts(selectedNode, contractsByMember)
    : [];

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  if (allNodes.length === 0) {
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
      {/* 직급별 레벨 행 렌더링 */}
      <div className="flex flex-col items-center">
        {activeLevels.map((rank, levelIdx) => (
          <div key={rank} className="w-full flex flex-col items-center">
            {/* 레벨 간 수직 연결선 */}
            {levelIdx > 0 && (
              <div className="h-8 w-0.5 bg-gray-300" />
            )}

            {/* 해당 직급 멤버 카드 행 */}
            <div className="flex flex-wrap justify-center gap-3 px-4 w-full">
              {byRank.get(rank)!.map((node) => (
                <OrgTreeNode
                  key={node.id}
                  node={node}
                  contractsByMember={contractsByMember}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </div>
        ))}
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
