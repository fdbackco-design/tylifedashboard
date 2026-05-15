'use client';

import { useMemo } from 'react';
import type { OrgTreeNode } from '@/lib/types';
import type { ContractItem } from '@/components/org-tree/OrgTreeNode';
import {
  OrgTreeContractDetailPanel,
  collectOrgTreeSubtreeContracts,
  findOrgTreeNode,
} from '@/components/org-tree/OrgTree';
import { collectStrippedNodeIdsForDisplay, stripOrgTreeNodesForDisplay } from '@/lib/organization/org-tree-display';

type Props = {
  roots: OrgTreeNode[];
  contractsByMember: Record<string, ContractItem[]>;
  /** 로그인 멤버 — 산하 계약 상세는 본인 노드만 표시 */
  defaultMemberId: string;
};

/**
 * /organization 메인: 조직도 캔버스 없이 본인 산하 계약 상세만 표시.
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

  const selectedNode = useMemo(
    () => findOrgTreeNode(displayRoots, defaultMemberId),
    [displayRoots, defaultMemberId],
  );

  const selectedContracts = useMemo(() => {
    if (!selectedNode) return [];
    return collectOrgTreeSubtreeContracts(
      selectedNode,
      contractsByMember,
      selectedNode.id === '__hq_root__' ? strippedNodeIds : undefined,
    );
  }, [selectedNode, contractsByMember, strippedNodeIds]);

  return selectedNode ? (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
      <OrgTreeContractDetailPanel
        node={selectedNode}
        contracts={selectedContracts}
        onClose={() => {}}
        hideProductAndContractCodeColumns
        hideCloseButton
      />
    </div>
  ) : (
    <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
      조직 트리에서 본인 정보를 찾을 수 없습니다.
    </p>
  );
}
