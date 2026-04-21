import type { OrgTreeNode } from '@/lib/types';
import { isOrgDisplayHiddenMemberName } from './org-display-hidden';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';

type ContractItemLike = {
  status: string;
  rental_request_no?: string | null;
  invoice_no?: string | null;
  memo?: string | null;
};

function isStrippedForDisplay(n: OrgTreeNode): boolean {
  const normalizedName = (n.name ?? '').replace(/^\[고객\]\s*/, '');
  if (normalizedName === '안성준' && n.rank === '영업사원') return true;
  if (n.rank === '영업사원' && isOrgDisplayHiddenMemberName(n.name ?? '')) return true;
  const isHqPerson = n.rank === '본사' && n.name !== '본사';
  if (isHqPerson) return true;
  return false;
}

/** strip로 인해 트리에서 숨겨지는 노드들의 id 목록 */
export function collectStrippedNodeIdsForDisplay(nodes: OrgTreeNode[]): string[] {
  const out: string[] = [];
  const visit = (n: OrgTreeNode) => {
    if (isStrippedForDisplay(n)) out.push(n.id);
    for (const ch of n.children ?? []) visit(ch);
  };
  for (const n of nodes) visit(n);
  return out;
}

/**
 * OrgTree 클라이언트와 동일: 조직도에 실제로 그려지는 트리에서
 * 숨김·본사(person) 노드를 제거하고 자식만 승격한다.
 */
export function stripOrgTreeNodesForDisplay(nodes: OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  for (const n of nodes) {
    if (isStrippedForDisplay(n)) {
      out.push(...stripOrgTreeNodesForDisplay((n.children ?? []) as OrgTreeNode[]));
      continue;
    }
    out.push({
      ...n,
      children: stripOrgTreeNodesForDisplay((n.children ?? []) as OrgTreeNode[]),
    });
  }
  return out;
}

function shouldHideLeafSalesMemberByContracts(params: {
  node: OrgTreeNode;
  contractsByMember: Record<string, ContractItemLike[]>;
}): boolean {
  const { node, contractsByMember } = params;
  if (node.rank !== '영업사원') return false;
  if ((node.children ?? []).length > 0) return false; // leaf only
  const contracts = contractsByMember[node.id] ?? [];
  if (contracts.length === 0) return false;
  // leaf 노드의 계약이 해약/렌탈 미충족만 존재하면 숨김
  const allBad = contracts.every((c) => {
    const display = getContractDisplayStatus({
      status: c.status,
      rental_request_no: c.rental_request_no ?? null,
      invoice_no: c.invoice_no ?? null,
      memo: c.memo ?? null,
    });
    return display === '해약' || display === '렌탈 미충족';
  });
  return allBad;
}

/**
 * 조직도 전용: leaf 영업사원 노드 중, 계약이 해약/렌탈 미충족만 있는 노드를 판정한다.
 * - 트리 구조(산하 집계/상세)는 유지하고, UI 렌더링에서만 숨기는 용도로 사용
 */
export function isHiddenLeafSalesMemberByContracts(params: {
  node: OrgTreeNode;
  contractsByMember: Record<string, ContractItemLike[]>;
}): boolean {
  return shouldHideLeafSalesMemberByContracts(params);
}

export function flattenOrgTreeNodes(nodes: OrgTreeNode[]): OrgTreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenOrgTreeNodes(n.children ?? [])]);
}
