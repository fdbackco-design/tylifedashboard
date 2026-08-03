import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectSubtreeContracts,
  countCompleted,
  sumJoinUnits,
  type ContractItem,
} from './org-tree-contract-counts';

function item(partial: Partial<ContractItem> & Pick<ContractItem, 'id' | 'contract_code'>): ContractItem {
  return {
    join_date: '2026-07-17',
    product_type: 'TY갤럭시케어',
    status: '가입',
    unit_count: 1,
    customer_name: '최지아',
    ...partial,
  };
}

describe('collectSubtreeContracts', () => {
  it('담당자·고객 노드에 중복 적재된 계약을 id 기준으로 한 번만 센다', () => {
    const shared = item({ id: 'c1', contract_code: 'TY00220260717' });
    const map: Record<string, ContractItem[]> = {
      sales: [shared, item({ id: 'c2', contract_code: 'TY00320260717' })],
      customer: [shared],
    };

    const collected = collectSubtreeContracts(['sales', 'customer'], map);
    assert.equal(collected.length, 2);
    assert.equal(sumJoinUnits(['sales', 'customer'], map), 2);
    assert.equal(countCompleted(['sales', 'customer'], map), 2);
  });
});
