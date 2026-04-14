'use client';

import type { OrgTreeNode as OrgTreeNodeType } from '@/lib/types';
import OrgTreeNode, { type ContractItem } from './OrgTreeNode';
import { useState } from 'react';

interface Props {
  roots: OrgTreeNodeType[];
  contractsByMember: Record<string, ContractItem[]>;
}

export default function OrgTree({ roots, contractsByMember }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  if (roots.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-gray-400">
        조직 데이터가 없습니다. 동기화 버튼으로 TY Life 데이터를 가져오세요.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {roots.map((root) => (
        <OrgTreeNode
          key={root.id}
          node={root}
          depth={0}
          contractsByMember={contractsByMember}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
}
