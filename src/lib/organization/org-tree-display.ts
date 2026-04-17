import type { OrgTreeNode } from '@/lib/types';
import { isOrgDisplayHiddenMemberName } from './org-display-hidden';

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

export function flattenOrgTreeNodes(nodes: OrgTreeNode[]): OrgTreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenOrgTreeNodes(n.children ?? [])]);
}
