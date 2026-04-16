'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import OrgTreeNode, {
  type ContractItem,
  collectSubtreeIds,
} from './OrgTreeNode';
import {
  getContractDisplayStatus,
  isContractJoinCompleted as isJoinCompleted,
} from '@/lib/utils/contract-display-status';

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
  return getContractDisplayStatus({
    status: c.status,
    rental_request_no: c.rental_request_no,
    invoice_no: c.invoice_no,
    memo: c.memo,
  });
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
  debug?: {
    enabled: boolean;
    hqId: string | null;
    hqEligibleTotal: number;
    hqEligibleMappedToCustomerNode: number;
    hqEligibleMissingCustomerNode: number;
    sampleMissing?: Array<{ contract_code: string; customer_id: string; customer_name: string; customer_phone: string | null }>;
  };
  metricsById?: Record<
    string,
    {
      cumulativeUnitCount: number;
      monthlyUnitCount: number;
      recognizedCommissionWon: number;
      paidCommissionWon: number;
    }
  >;
}

export default function OrgTree({ roots, contractsByMember, metricsById, debug }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  // 트리를 평탄화해 전체 노드 목록 확보
  const allNodes = useMemo(() => flattenTree(roots), [roots]);

  /**
   * UI 전용:
   * - 최상위 루트는 항상 "본사" 1개로 보이게 한다.
   * - "안성준(본사)" 개인 노드는 조직도에서 숨긴다.
   *   (안성준 노드 아래에 있던 자식들은 본사 루트 아래로 승격)
   *
   * 데이터(organization_edges)는 건드리지 않는다.
   */
  const displayRoots = useMemo<OrgTreeNodeType[]>(() => {
    if (!roots || roots.length === 0) return [];

    // "본사" 개인 노드(예: 안성준)가 중복으로 존재할 수 있으므로,
    // UI에서는 본사(person) 노드를 모두 제거하고 자식만 승격한다.
    function stripHqPersonNodes(nodes: OrgTreeNodeType[]): OrgTreeNodeType[] {
      const out: OrgTreeNodeType[] = [];
      for (const n of nodes) {
        const normalizedName = (n.name ?? '').replace(/^\[고객\]\s*/, '');
        // 영업사원으로 생성된 "[고객] 안성준" 노드는 조직도에서 숨김
        if (normalizedName === '안성준' && n.rank === '영업사원') {
          out.push(...stripHqPersonNodes((n.children ?? []) as OrgTreeNodeType[]));
          continue;
        }
        const isHqPerson = n.rank === '본사' && n.name !== '본사';
        if (isHqPerson) {
          // 본사(person) 노드는 숨기고 자식만 같은 레벨로 승격
          out.push(...stripHqPersonNodes((n.children ?? []) as OrgTreeNodeType[]));
          continue;
        }
        out.push({
          ...n,
          children: stripHqPersonNodes((n.children ?? []) as OrgTreeNodeType[]),
        });
      }
      return out;
    }

    const cleanedRoots = stripHqPersonNodes(roots);

    const hqRoot: OrgTreeNodeType = {
      id: '__hq_root__',
      name: '본사',
      rank: '본사',
      // 본사 아래로: (안성준의 자식들) + (기타 루트들)
      children: cleanedRoots,
    } as OrgTreeNodeType;

    return [hqRoot];
  }, [roots]);

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  useEffect(() => {
    if (!debug?.enabled) return;
    // eslint-disable-next-line no-console
    console.log('[org-debug] summary', debug);
  }, [debug]);

  const selectedNode = selectedId ? findNode(displayRoots, selectedId) : null;
  const selectedContracts = selectedNode
    ? collectSubtreeContracts(selectedNode, contractsByMember)
    : [];

  useEffect(() => {
    if (!debug?.enabled) return;
    if (!selectedId) return;
    const list = contractsByMember[selectedId] ?? [];
    // eslint-disable-next-line no-console
    console.log('[org-debug] select', { selectedId, directContracts: list.length, sample: list.slice(0, 3) });
  }, [debug?.enabled, selectedId, contractsByMember]);

  function TreeSubtree({ node }: { node: OrgTreeNodeType }) {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;

    return (
      <div className="flex flex-col items-center">
        {/* 노드 카드 */}
        <OrgTreeNode
          node={node}
          contractsByMember={contractsByMember}
          nodeMetrics={metricsById?.[node.id] ?? null}
          selectedId={selectedId}
          onSelect={handleSelect}
        />

        {/* 자식 서브트리 */}
        {hasChildren && (
          <div className="relative mt-6 pt-6 w-full">
            {/* 부모 -> 자식들 수직 라인 */}
            <div className="absolute left-1/2 top-0 -translate-x-1/2 h-6 w-px bg-gray-300" />

            {/* 자식들 상단 수평 라인 */}
            {children.length > 1 && (
              <div className="absolute left-4 right-4 top-6 h-px bg-gray-300" />
            )}

            <div className="flex flex-wrap justify-center gap-6 px-4">
              {children.map((ch) => (
                <div key={ch.id} className="relative flex flex-col items-center">
                  {/* 수평 라인 -> 자식 수직 라인 */}
                  <div className="absolute left-1/2 top-0 -translate-x-1/2 h-6 w-px bg-gray-300" />
                  <TreeSubtree node={ch} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
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

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    const handler = (e: WheelEvent) => {
      // 이 영역에서는 스크롤 대신 줌
      e.preventDefault();

      const delta = e.deltaY;
      const factor = Math.exp(-delta * 0.001);
      setScale((prev) => clamp(prev * factor, 0.4, 2.5));
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as EventListener);
  }, []);

  return (
    <div>
      {/* 줌 가능한 뷰포트 */}
      <div
        ref={viewportRef}
        className={`w-full overflow-hidden rounded-lg select-none ${dragRef.current.active ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="휠: 확대/축소 · 드래그: 이동"
        onPointerDown={(e) => {
          // 캔버스처럼 패닝: pointer capture로 영역 밖으로 나가도 드래그 유지
          if (e.button !== 0) return;
          // 카드 위에서 시작한 포인터는 "클릭 선택"을 우선 (패닝은 빈 공간 드래그로만)
          if (e.currentTarget !== e.target) return;
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            baseX: pan.x,
            baseY: pan.y,
          };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current.active) return;
          e.preventDefault();
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          setPan({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
        }}
        onPointerUp={(e) => {
          dragRef.current.active = false;
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }}
        onPointerCancel={() => {
          dragRef.current.active = false;
        }}
      >
        <div
          style={{
            // zoom은 레이아웃에도 반영되어 축소 시 한 줄에 더 많이 배치됨
            ...( { zoom: scale } as unknown as React.CSSProperties ),
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            transformOrigin: 'top center',
          }}
        >
          {/* parent-child 기반 nested tree 렌더링 */}
          <div className="flex flex-col items-center gap-10 py-6">
            {displayRoots.map((r) => (
              <TreeSubtree key={r.id} node={r} />
            ))}
          </div>
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
