'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import OrgTreeNode, {
  type ContractItem,
  collectSubtreeIds,
} from './OrgTreeNode';
import { getContractDisplayProductName } from '@/lib/utils/contract-display-product';
import {
  getContractDisplayStatus,
  isContractJoinCompleted as isJoinCompleted,
} from '@/lib/utils/contract-display-status';
import {
  flattenOrgTreeNodes,
  collectStrippedNodeIdsForDisplay,
  stripOrgTreeNodesForDisplay,
  isHiddenLeafSalesMemberByContracts,
} from '@/lib/organization/org-tree-display';

/** id로 노드 찾기 (외부 상세 UI용 export) */
export function findOrgTreeNode(nodes: OrgTreeNodeType[], id: string): OrgTreeNodeType | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findOrgTreeNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** 선택된 노드의 산하 계약 전체 수집 (외부 상세 UI용 export) */
export function collectOrgTreeSubtreeContracts(
  node: OrgTreeNodeType,
  map: Record<string, ContractItem[]>,
  extraIds?: string[],
): ContractItem[] {
  const ids = [...new Set([...collectSubtreeIds(node), ...(extraIds ?? [])])];
  return ids
    .flatMap((id) => map[id] ?? [])
    .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));
}

const STATUS_COLOR: Record<string, string> = {
  준비: 'text-gray-400', 대기: 'text-yellow-500', 상담중: 'text-blue-400',
  가입: 'text-green-600', 해피콜완료: 'text-cyan-600', 배송준비: 'text-purple-500',
  배송완료: 'text-teal-600', 정산완료: 'text-green-700', 취소: 'text-red-400', 해약: 'text-red-600',
  '렌탈 미충족': 'text-orange-700',
};

type AggregatedContract = {
  key: string;
  sales_member_name: string;
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
        sales_member_name: c.sales_member_name?.trim() || '-',
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
    if (existing.sales_member_name === '-' && c.sales_member_name?.trim()) {
      existing.sales_member_name = c.sales_member_name.trim();
    }
    if (!existing.item_name && c.item_name) existing.item_name = c.item_name;
    if (isRentalUnmet(c)) existing.show_rental_unmet = true;
    existing.contract_codes.push(c.contract_code);
  }

  return [...map.values()].sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''));
}

// ── 계약 패널 ─────────────────────────────────────────────
export function OrgTreeContractDetailPanel({
  node,
  contracts,
  onClose,
  variant = 'default',
  /** true면 상품·계약코드 열만 숨김(데이터·집계 로직은 동일) */
  hideProductAndContractCodeColumns = false,
  /** true면 닫기 버튼 숨김(항상 표시 페이지 등) */
  hideCloseButton = false,
}: {
  node: OrgTreeNodeType;
  contracts: ContractItem[];
  onClose: () => void;
  /** bottom-sheet 등: 상단 여백·구분선 축소, 닫기 버튼 숨김 */
  variant?: 'default' | 'embedded';
  hideProductAndContractCodeColumns?: boolean;
  hideCloseButton?: boolean;
}) {
  const aggregated = aggregateContracts(contracts);
  const completedCount = contracts.filter(isJoinCompleted).length;

  return (
    <div
      className={
        variant === 'embedded'
          ? 'border-0 pt-0 mt-0'
          : 'mt-4 pt-1'
      }
    >
      <div className="mb-3 px-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-gray-800 text-sm truncate">{node.name}</span>
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                {node.rank}
              </span>
              {completedCount > 0 && (
                <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                  가입 {completedCount}건
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-gray-500">
              산하 전체 {contracts.length}건 · 묶음 {aggregated.length}건
            </div>
          </div>

          {variant === 'default' && !hideCloseButton ? (
            <button
              onClick={onClose}
              className="shrink-0 text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100 whitespace-nowrap"
            >
              닫기 ✕
            </button>
          ) : null}
        </div>
      </div>

      {contracts.length === 0 ? (
        <p className="text-xs text-gray-400 px-1 py-4 text-center">산하 계약 없음</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">담당자</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">고객명</th>
                {!hideProductAndContractCodeColumns ? (
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">상품</th>
                ) : null}
                <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">물품명</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">상태</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">구좌</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">가입일</th>
                {!hideProductAndContractCodeColumns ? (
                  <th className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">계약코드</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {aggregated.map((c) => {
                return (
                  <tr key={c.key} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {c.sales_member_name}
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">
                      {c.customer_name}
                    </td>
                    {!hideProductAndContractCodeColumns ? (
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                        {getContractDisplayProductName({ product_type: c.product_type }) ?? '-'}
                      </td>
                    ) : null}
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
                    {!hideProductAndContractCodeColumns ? (
                      <td
                        title={c.contract_codes.join(', ')}
                        className="px-3 py-2 text-gray-400 font-mono whitespace-nowrap"
                      >
                        {c.contract_codes.length <= 1
                          ? c.contract_codes[0]
                          : `${c.contract_codes[0]} 외 ${c.contract_codes.length - 1}건`}
                      </td>
                    ) : null}
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
  /** 편집 모드(조직 수정) 노출 여부. 기본 true */
  editable?: boolean;
  /** 노드 카드의 수당/실지급액(지표) 노출 여부. 기본 true */
  showMetrics?: boolean;
  /** showMetrics가 true일 때 인정수당·실지급액만 표시할지. false면 누적/월 구좌만 표시. 기본 true */
  showCommissionMetrics?: boolean;
  /** /organization 전용: 예상수당+목표 게이지 표시 */
  showForecast?: boolean;
  /** /organization 전용: 최상단 가상 '본사(__hq_root__)' 카드를 숨김(레이아웃용 루트는 유지). 기본 false */
  hideHqRoot?: boolean;
  metricsById?: Record<
    string,
    {
      cumulativeUnitCount: number;
      monthlyUnitCount: number;
      recognizedCommissionWon: number;
      paidCommissionWon: number;
    }
  >;
  /**
   * showForecast 시 노드 카드의 게이지/남은 구좌 계산에 쓸 멤버별 목표 구좌.
   * 미지정 멤버는 OrgTreeNode 내부에서 20 으로 폴백한다. 정산/집계에는 무관.
   */
  goalUnitsByMemberId?: Record<string, number>;
  /**
   * showMetrics 영역(누적/월 구좌)에 "목표 구좌" 줄을 추가로 표시할지.
   * 기본 false. /admin/organization 처럼 관리자 화면에서만 켠다.
   */
  showGoalUnitsLine?: boolean;
  /**
   * showMetrics 영역에 달성률(%) + 색별 게이지바를 추가로 표시할지.
   * 기본 false. /admin/organization 처럼 관리자 화면에서만 켠다.
   */
  showGoalProgressBar?: boolean;
  /** inline: 기존처럼 트리 아래 패널. bottom-sheet: 모바일형 하단 시트 */
  contractDetailPresentation?: 'inline' | 'bottom-sheet';
  /** 멤버용 조직 페이지: 상세 테이블에서 상품·계약코드 열 숨김 */
  contractDetailHideProductAndContractCode?: boolean;
  /**
   * 상단에 담당자 이름 검색창 노출 여부 (기본 true).
   * - 검색 결과를 선택하면 해당 노드를 viewport 중앙으로 이동하고 일시적으로 강조 표시한다.
   * - 기존 드래그/휠/핀치 줌 동작과 분리되어 동작한다.
   */
  showSearch?: boolean;
}

export default function OrgTree({
  roots,
  contractsByMember,
  metricsById,
  goalUnitsByMemberId,
  showGoalUnitsLine = false,
  showGoalProgressBar = false,
  editable = true,
  showMetrics = true,
  showCommissionMetrics = true,
  showForecast = false,
  hideHqRoot = false,
  contractDetailPresentation = 'inline',
  contractDetailHideProductAndContractCode = false,
  showSearch = true,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // ── 담당자 이름 검색 ────────────────────────────────────
  // - searchQuery: 입력 중 검색어. 비어 있으면 결과 패널을 닫는다.
  // - highlightedId: focusMember 호출 직후 일시적으로 강조할 노드 id (수 초 후 해제).
  // - searchOpen: 입력에 포커스가 있고 검색어가 있을 때만 결과 드롭다운을 보여준다.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editMessage, setEditMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragChildId, setDragChildId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  // 모바일 핀치 줌(2손가락) 상태
  const pinchRef = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    active: boolean;
    startDistance: number;
    startScale: number;
    startPan: { x: number; y: number };
    startMid: { x: number; y: number };
  }>({
    pointers: new Map(),
    active: false,
    startDistance: 0,
    startScale: 1,
    startPan: { x: 0, y: 0 },
    startMid: { x: 0, y: 0 },
  });

  // 트리를 평탄화해 전체 노드 목록 확보
  const allNodes = useMemo(() => flattenOrgTreeNodes(roots as OrgTreeNodeType[]), [roots]);
  const strippedNodeIds = useMemo(() => collectStrippedNodeIdsForDisplay(roots as OrgTreeNodeType[]), [roots]);

  // ── 검색용 멤버 인덱스 ────────────────────────────────
  // - 노드에 실제로 렌더되는 displayName(접두 '[고객] ' 제거)을 기준으로 한다.
  // - '__hq_root__' 같은 가상 루트와 본사(person) 노드는 검색 결과에서 제외한다.
  // - displayRoots 가 아닌 원본 roots 의 flatten 결과를 사용해, 본사 아래로 승격된 자식들의 실제 id 와 동일하게 잡힌다.
  const searchableMembers = useMemo(() => {
    type SearchItem = { id: string; name: string; rank: string };
    const out: SearchItem[] = [];
    for (const n of allNodes) {
      if (!n?.id) continue;
      if (n.id === '__hq_root__') continue;
      const displayName = (n.name ?? '').replace(/^\[고객\]\s*/, '').trim();
      if (!displayName) continue;
      out.push({ id: n.id, name: displayName, rank: String(n.rank ?? '') });
    }
    return out;
  }, [allNodes]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    const qLower = q.toLowerCase();
    return searchableMembers
      .filter((m) => m.name.toLowerCase().includes(qLower))
      .slice(0, 20);
  }, [searchQuery, searchableMembers]);

  /**
   * 지정한 멤버 노드를 viewport 중앙으로 이동시키고 일시적으로 강조 표시한다.
   * - 현재 transform: outer translate(pan) + inner scale(scale) 구조.
   * - 노드 카드의 화면 좌표(getBoundingClientRect)와 viewport 중심의 차이만큼 pan 만 보정하면
   *   scale 값에 관계없이 정확히 중앙에 위치한다. (scale 은 그대로 유지)
   */
  const focusMember = (memberId: string) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const card = vp.querySelector<HTMLElement>(
      `[data-org-member-id="${(window as any).CSS && CSS.escape ? CSS.escape(memberId) : memberId}"]`,
    );
    if (!card) return;

    const vpRect = vp.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const nodeCenterX = (cardRect.left + cardRect.right) / 2 - vpRect.left;
    const nodeCenterY = (cardRect.top + cardRect.bottom) / 2 - vpRect.top;
    const vpCenterX = vpRect.width / 2;
    const vpCenterY = vpRect.height / 2;

    setPan((prev) => ({
      x: prev.x + (vpCenterX - nodeCenterX),
      y: prev.y + (vpCenterY - nodeCenterY),
    }));

    setHighlightedId(memberId);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedId(null);
      highlightTimerRef.current = null;
    }, 2400);
    setSearchOpen(false);
  };

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, []);

  // 개인 조직도 등 read-only 화면에서는 편집 모드를 강제로 끈다.
  useEffect(() => {
    if (!editable && editMode) {
      setEditMode(false);
      setEditMessage(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

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
    // UI에서는 본사(person) 노드를 모두 제거하고 자식만 승격한다. (서버 직급 배지와 동일 로직)
    const cleanedRoots = stripOrgTreeNodesForDisplay(roots as OrgTreeNodeType[]);

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

  async function handleMoveNode(params: { childId: string; parentId: string | null }) {
    setEditMessage(null);
    try {
      const res = await fetch('/api/organization', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_id: params.childId, parent_id: params.parentId }),
      });
      const json = (await res.json()) as any;
      if (!res.ok || !json?.success) {
        setEditMessage({ ok: false, text: json?.error ?? '관계 변경 실패' });
        return;
      }
      const ym = String(json?.year_month ?? '');
      const st = json?.settlement ?? null;
      const settlementMsg =
        st?.recalculated
          ? `${ym} 정산 ${st.updated_count ?? 0}명 재계산`
          : (st?.skipped_reason ? `정산 재계산 스킵: ${st.skipped_reason}` : '정산 재계산 스킵');
      setEditMessage({ ok: true, text: `관계 변경 완료 · ${settlementMsg}` });
    } catch {
      setEditMessage({ ok: false, text: '네트워크 오류' });
    }
  }

  useEffect(() => {
    // 편집 모드를 끄면 하이라이트 상태도 초기화
    if (!editMode) {
      setDragChildId(null);
      setDragOverId(null);
    }
  }, [editMode]);

  useEffect(() => {
    if (contractDetailPresentation !== 'bottom-sheet' || !selectedId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [contractDetailPresentation, selectedId]);

  const selectedNode = selectedId ? findOrgTreeNode(displayRoots, selectedId) : null;
  const selectedContracts = selectedNode
    ? collectOrgTreeSubtreeContracts(
        selectedNode,
        contractsByMember,
        selectedNode.id === '__hq_root__' ? strippedNodeIds : undefined,
      )
    : [];

  function TreeSubtree({ node }: { node: OrgTreeNodeType }) {
    const children = node.children ?? [];
    const hasChildren = children.length > 0;
    const isHqRoot = node.id === '__hq_root__';
    const hideCard =
      (hideHqRoot && isHqRoot) ||
      isHiddenLeafSalesMemberByContracts({
      node: node as any,
      contractsByMember: contractsByMember as any,
    });
    const isDropTarget = editMode && !hideCard && dragOverId === node.id;
    const isInvalidDrop = editMode && !!dragChildId && (dragChildId === node.id);

    return (
      <div className="flex flex-col items-center">
        {/* 노드 카드 */}
        {hideCard ? null : (
          <div
            draggable={editMode && node.id !== '__hq_root__'}
            onDragStart={(e) => {
              if (!editMode) return;
              e.dataTransfer.setData('text/org-child-id', node.id);
              e.dataTransfer.effectAllowed = 'move';
              setDragChildId(node.id);
              setDragOverId(null);
            }}
            onDragEnd={() => {
              setDragChildId(null);
              setDragOverId(null);
            }}
            onDragOver={(e) => {
              if (!editMode) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDragOverId(node.id);
            }}
            onDragEnter={() => {
              if (!editMode) return;
              setDragOverId(node.id);
            }}
            onDragLeave={() => {
              if (!editMode) return;
              // 자식 요소로 이동하면서 dragleave가 튀는 경우가 있어서, "현재 타겟"만 정리
              setDragOverId((prev) => (prev === node.id ? null : prev));
            }}
            onDrop={(e) => {
              if (!editMode) return;
              e.preventDefault();
              const childId = e.dataTransfer.getData('text/org-child-id');
              const parentId = node.id === '__hq_root__' ? null : node.id;
              if (!childId) return;
              if (childId === parentId) return;
              setDragChildId(null);
              setDragOverId(null);
              handleMoveNode({ childId, parentId });
            }}
            className={
              editMode
                ? [
                    'rounded-xl transition-all',
                    isDropTarget
                      ? (isInvalidDrop
                          ? 'ring-2 ring-red-400 ring-offset-2 bg-red-50/40'
                          : 'ring-2 ring-emerald-400 ring-offset-2 bg-emerald-50/40')
                      : 'outline outline-1 outline-transparent hover:outline-slate-300',
                  ].join(' ')
                : undefined
            }
            title={editMode ? '드롭: 이 노드 산하로 이동' : undefined}
          >
            <OrgTreeNode
              node={node}
              contractsByMember={contractsByMember}
              extraSubtreeIds={isHqRoot ? strippedNodeIds : undefined}
              showMetrics={showMetrics}
              showCommissionMetrics={showCommissionMetrics}
              showForecast={showForecast}
              goalUnits={goalUnitsByMemberId?.[node.id]}
              showGoalUnitsLine={showGoalUnitsLine}
              showGoalProgressBar={showGoalProgressBar}
              nodeMetrics={metricsById?.[node.id] ?? null}
              selectedId={selectedId}
              onSelect={handleSelect}
              isHighlighted={highlightedId === node.id}
            />
          </div>
        )}

        {/* 자식 서브트리 */}
        {hasChildren && (
          <div
            className={`mt-6 pt-6 w-full touch-none ${isHqRoot ? 'overflow-x-visible' : ''}`}
          >
            <div className="relative w-full">
              {/* 부모 -> 자식들 수직 라인 */}
              {hideCard ? null : (
                <div className="absolute left-1/2 top-0 -translate-x-1/2 h-6 w-px bg-gray-300" />
              )}

              {isHqRoot ? (
                // 본사 직속은 한 줄(가로 스크롤)로 고정
                <div className="relative w-max mx-auto px-4">
                  {/* 자식들 상단 수평 라인 (스크롤 컨텐츠 폭 기준) */}
                  {children.length > 1 && (
                    <div className="absolute left-4 right-4 top-6 h-px bg-gray-300" />
                  )}
                  <div className="flex flex-nowrap justify-center gap-6 py-0">
                    {children.map((ch) => (
                      <div key={ch.id} className="relative flex flex-col items-center">
                        {/* 수평 라인 -> 자식 수직 라인 */}
                        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-6 w-px bg-gray-300" />
                        <TreeSubtree node={ch} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}
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
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setScale((prevScale) => {
        // 모바일에서도 노드가 안 잘리도록 최소 줌을 더 허용
        const nextScale = clamp(prevScale * factor, 0.2, 2.5);
        // 포인터 중심(focal) 줌: 화면 좌표(mouse)가 같은 컨텐츠 좌표를 계속 가리키도록 pan 보정
        setPan((prevPan) => {
          const contentX = (mouseX - prevPan.x) / prevScale;
          const contentY = (mouseY - prevPan.y) / prevScale;
          return {
            x: mouseX - contentX * nextScale,
            y: mouseY - contentY * nextScale,
          };
        });
        return nextScale;
      });
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler as EventListener);
  }, []);

  // 모바일(Safari 등): 자식 overflow·기본 터치 제스처가 패닝/핀치를 가로채는 것을 막기 위해
  // 뷰포트에서 touchmove를 비-passive로 막는다(Pointer 이벤트와 병행).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 1) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
        <div className="text-xs text-gray-500">
          {editMode ? '편집 모드 : 노드를 드래그해서 부모 노드 위에 놓으면 소속이 변경됩니다.' : '보기 모드 : 한 손가락 이동 · 두 손가락 줌'}
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {editMessage && (
            <span className={`text-xs ${editMessage.ok ? 'text-green-700' : 'text-red-600'}`}>
              {editMessage.text}
            </span>
          )}
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setEditMode((v) => !v);
                setEditMessage(null);
              }}
              className={`px-3 py-1.5 text-xs rounded border ${
                editMode ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {editMode ? '편집 종료' : '조직 수정'}
            </button>
          ) : null}
        </div>
      </div>

      {/*
        담당자 이름 검색 UI
        - 편집 모드와 동시에 활성화돼도 viewport 의 포인터 이벤트와는 분리돼 있어 충돌하지 않는다.
        - showSearch=false 이면 전체를 숨긴다.
      */}
      {showSearch ? (
        <div className="mb-3">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => {
                if (searchQuery.trim()) setSearchOpen(true);
              }}
              onBlur={() => {
                // 결과 항목 클릭이 가능하도록 약간 지연 후 닫기
                setTimeout(() => setSearchOpen(false), 120);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const q = searchQuery.trim();
                  if (!q) return;
                  if (searchResults.length === 0) return;
                  // 정확 일치(대소문자 무시) 우선, 없으면 첫 결과
                  const exact = searchResults.find((m) => m.name.toLowerCase() === q.toLowerCase());
                  focusMember((exact ?? searchResults[0]).id);
                } else if (e.key === 'Escape') {
                  setSearchOpen(false);
                }
              }}
              placeholder="담당자 이름 검색"
              aria-label="담당자 이름 검색"
              className="w-full h-9 rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-sm shadow-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200/80"
            />
            {searchQuery ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  // input blur 보다 먼저 동작하도록 mousedown 사용
                  e.preventDefault();
                  setSearchQuery('');
                  setSearchOpen(false);
                }}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            ) : null}

            {searchOpen && searchQuery.trim() ? (
              <div
                className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg"
                // 결과 영역 클릭은 input blur 보다 먼저 동작해 focusMember 가 호출되도록 mousedown 우선 처리
                onMouseDown={(e) => e.preventDefault()}
              >
                {searchResults.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400">검색 결과 없음</div>
                ) : (
                  searchResults.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => focusMember(m.id)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="text-[11px] text-slate-500">{m.rank || '-'}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 줌 가능한 뷰포트 */}
      <div
        ref={viewportRef}
        className={`w-full h-[60vh] sm:h-[70vh] lg:h-[75vh] overflow-hidden rounded-lg select-none touch-none ${dragRef.current.active ? 'cursor-grabbing' : 'cursor-grab'}`}
        title="휠: 확대/축소 · 한 손가락: 이동 · 두 손가락: 줌"
        onPointerDown={(e) => {
          // 캔버스처럼 패닝: pointer capture로 영역 밖으로 나가도 드래그 유지
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          if (editMode) return;

          const el = e.currentTarget as HTMLDivElement;

          // 터치 포인터는 핀치 줌을 위해 추적
          if (e.pointerType === 'touch') {
            const rect = el.getBoundingClientRect();
            pinchRef.current.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

            if (pinchRef.current.pointers.size === 2) {
              e.preventDefault();
              const pts = [...pinchRef.current.pointers.values()];
              const dx = pts[0].x - pts[1].x;
              const dy = pts[0].y - pts[1].y;
              pinchRef.current.active = true;
              pinchRef.current.startDistance = Math.hypot(dx, dy) || 1;
              pinchRef.current.startScale = scale;
              pinchRef.current.startPan = { ...pan };
              pinchRef.current.startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
              dragRef.current.active = false;
              try {
                el.setPointerCapture(e.pointerId);
              } catch {
                // ignore
              }
              return;
            }
          }

          // 노드 카드 위에서 시작한 포인터는 "클릭 선택"을 우선 (패닝은 카드 밖 드래그)
          const target = e.target as HTMLElement | null;
          const isOnCard = !!target?.closest?.('[data-org-node-card="1"]');
          // 모바일(터치)에서는 카드 위에서도 패닝을 허용해야 노드가 잘리지 않음
          if (isOnCard && e.pointerType !== 'touch') return;
          e.preventDefault();
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          dragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            baseX: pan.x,
            baseY: pan.y,
          };
        }}
        onPointerMove={(e) => {
          // 핀치 줌 처리(2손가락)
          if (e.pointerType === 'touch' && pinchRef.current.pointers.has(e.pointerId)) {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            pinchRef.current.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });

            if (pinchRef.current.active && pinchRef.current.pointers.size === 2) {
              e.preventDefault();
              const pts = [...pinchRef.current.pointers.values()];
              const dx = pts[0].x - pts[1].x;
              const dy = pts[0].y - pts[1].y;
              const dist = Math.hypot(dx, dy) || 1;
              const factor = dist / (pinchRef.current.startDistance || 1);
              const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
              const nextScale = clamp(pinchRef.current.startScale * factor, 0.2, 2.5);
              const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };

              // midpoint 기준으로 컨텐츠가 유지되도록 pan 보정
              const startScale = pinchRef.current.startScale;
              const startPan = pinchRef.current.startPan;
              const contentX = (pinchRef.current.startMid.x - startPan.x) / startScale;
              const contentY = (pinchRef.current.startMid.y - startPan.y) / startScale;

              setScale(nextScale);
              setPan({ x: mid.x - contentX * nextScale, y: mid.y - contentY * nextScale });
              return;
            }
          }

          if (!dragRef.current.active) return;
          e.preventDefault();
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          setPan({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
        }}
        onPointerUp={(e) => {
          dragRef.current.active = false;
          if (pinchRef.current.pointers.has(e.pointerId)) {
            pinchRef.current.pointers.delete(e.pointerId);
            if (pinchRef.current.pointers.size < 2) pinchRef.current.active = false;
          }
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }}
        onPointerCancel={(e) => {
          dragRef.current.active = false;
          if (pinchRef.current.pointers.has(e.pointerId)) {
            pinchRef.current.pointers.delete(e.pointerId);
            if (pinchRef.current.pointers.size < 2) pinchRef.current.active = false;
          }
          try {
            (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
        }}
      >
        {/* 고정 레이아웃 트리를 transform(translate+scale)로만 확대/이동 · touch-none으로 브라우저 기본 제스처 경합 방지 */}
        <div className="touch-none" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
          <div className="touch-none" style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            {/* parent-child 기반 nested tree 렌더링 */}
            <div className="flex touch-none flex-col items-center gap-10 py-6">
              {displayRoots.map((r) => (
                <TreeSubtree key={r.id} node={r} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 선택된 멤버의 산하 계약 */}
      {contractDetailPresentation === 'inline' && selectedNode ? (
        <OrgTreeContractDetailPanel
          node={selectedNode}
          contracts={selectedContracts}
          onClose={() => setSelectedId(null)}
          hideProductAndContractCodeColumns={contractDetailHideProductAndContractCode}
        />
      ) : null}

      {contractDetailPresentation === 'bottom-sheet' && selectedNode ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="배경 닫기"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSelectedId(null)}
          />
          <div className="relative z-10 flex max-h-[min(88vh,900px)] w-full flex-col rounded-t-2xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-2xl sm:shadow-xl">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
              <span className="text-sm font-semibold text-gray-800">산하 계약</span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-6 pt-2">
              <OrgTreeContractDetailPanel
                variant="embedded"
                node={selectedNode}
                contracts={selectedContracts}
                onClose={() => setSelectedId(null)}
                hideProductAndContractCodeColumns={contractDetailHideProductAndContractCode}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
