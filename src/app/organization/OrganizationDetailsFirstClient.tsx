'use client';

import { useMemo, useState, useEffect } from 'react';
import type { OrgTreeNode } from '@/lib/types';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import {
  OrgTreeContractDetailPanel,
  collectOrgTreeSubtreeContracts,
  findOrgTreeNode,
} from '@/components/org-tree/OrgTree';
import {
  collectStrippedNodeIdsForDisplay,
  flattenOrgTreeNodes,
  stripOrgTreeNodesForDisplay,
} from '@/lib/organization/org-tree-display';

type Props = {
  roots: OrgTreeNode[];
  contractsByMember: Record<string, ContractItem[]>;
  defaultMemberId: string;
};

/**
 * /organization 메인: 조직도 캔버스 없이 멤버 선택 + OrgTree와 동일한 산하 계약 상세 패널.
 * displayRoots / strippedNodeIds 규칙은 OrgTree 내부와 동일하게 유지한다.
 */
export default function OrganizationDetailsFirstClient({
  roots,
  contractsByMember,
  defaultMemberId,
}: Props) {
  const strippedNodeIds = useMemo(() => collectStrippedNodeIdsForDisplay(roots), [roots]);

  const displayRoots = useMemo<OrgTreeNode[]>(() => {
    if (!roots || roots.length === 0) return [];
    const cleanedRoots = stripOrgTreeNodesForDisplay(roots);
    const hqRoot: OrgTreeNode = {
      id: '__hq_root__',
      name: '본사',
      rank: '본사',
      children: cleanedRoots,
    } as OrgTreeNode;
    return [hqRoot];
  }, [roots]);

  const flatNodes = useMemo(() => flattenOrgTreeNodes(displayRoots), [displayRoots]);

  const [selectedId, setSelectedId] = useState<string>(defaultMemberId);

  useEffect(() => {
    setSelectedId(defaultMemberId);
  }, [defaultMemberId, roots]);

  useEffect(() => {
    const ids = new Set(flatNodes.map((n) => n.id));
    if (ids.size === 0) return;
    if (ids.has(selectedId)) return;
    const next = ids.has(defaultMemberId) ? defaultMemberId : flatNodes[0]!.id;
    setSelectedId(next);
  }, [flatNodes, selectedId, defaultMemberId]);

  const selectedNode = useMemo(() => {
    const n = findOrgTreeNode(displayRoots, selectedId);
    return n;
  }, [displayRoots, selectedId]);

  const selectedContracts = useMemo(() => {
    if (!selectedNode) return [];
    return collectOrgTreeSubtreeContracts(
      selectedNode,
      contractsByMember,
      selectedNode.id === '__hq_root__' ? strippedNodeIds : undefined,
    );
  }, [selectedNode, contractsByMember, strippedNodeIds]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-4">
        <label htmlFor="org-detail-member" className="block text-xs font-semibold text-slate-600 sm:text-sm">
          멤버 선택
        </label>
        <select
          id="org-detail-member"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
        >
          {flatNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id === '__hq_root__' ? `${n.name} (산하 전체)` : `${n.name} · ${n.rank}`}
            </option>
          ))}
        </select>
      </div>

      {selectedNode ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
          <OrgTreeContractDetailPanel
            node={selectedNode}
            contracts={selectedContracts}
            onClose={() => setSelectedId(defaultMemberId)}
            hideProductAndContractCodeColumns
          />
        </div>
      ) : (
        <p className="text-center text-sm text-slate-500">선택한 멤버를 트리에서 찾을 수 없습니다.</p>
      )}
    </div>
  );
}
