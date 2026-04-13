'use client';

import { useState } from 'react';
import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';

const RANK_COLORS: Record<string, string> = {
  본사: 'bg-slate-800 text-white',
  사업본부장: 'bg-indigo-700 text-white',
  센터장: 'bg-blue-600 text-white',
  리더: 'bg-cyan-600 text-white',
  영업사원: 'bg-gray-100 text-gray-700',
};

interface Props {
  node: OrgTreeNodeType;
  depth?: number;
}

export default function OrgTreeNode({ node, depth = 0 }: Props) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer ${depth === 0 ? 'font-semibold' : ''}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        onClick={() => hasChildren && setExpanded((v) => !v)}
      >
        {/* 접기/펼치기 토글 */}
        {hasChildren ? (
          <span className="w-4 text-gray-400 text-xs leading-none">
            {expanded ? '▾' : '▸'}
          </span>
        ) : (
          <span className="w-4" />
        )}

        {/* 직급 뱃지 */}
        <span
          className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${RANK_COLORS[node.rank] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {node.rank}
        </span>

        {/* 이름 */}
        <span className="text-sm text-gray-800">{node.name}</span>

        {/* 하위 인원 수 */}
        {hasChildren && (
          <span className="text-xs text-gray-400 ml-auto">
            ({node.children.length}명)
          </span>
        )}
      </div>

      {/* 하위 노드 */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <OrgTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
