import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import {
  subtreeJoinUnitsForLeaderMaintenanceInWindow,
  type AttributedJoinContractRow,
  type SalesMemberPromotionThreshold,
} from './leader-promotion';

const LEADER_A = 'leader-a';
const LEADER_B = 'leader-b';
const SALES_C = 'sales-c';

function row(
  id: string,
  name: string,
  rank: OrgTreeRow['rank'],
  parent_id: string | null,
  depth: number,
): OrgTreeRow {
  return { id, name, rank, parent_id, depth };
}

function contract(
  id: string,
  salesMemberId: string,
  units: number,
  happyCallYmd: string,
): AttributedJoinContractRow {
  return {
    id,
    contract_code: id,
    sales_member_id: salesMemberId,
    unit_count: units,
    join_date: happyCallYmd,
    happy_call_at: `${happyCallYmd}T03:00:00Z`,
    created_at: `${happyCallYmd}T04:00:00Z`,
    invoice_registered_at: `${happyCallYmd}T05:00:00Z`,
  } as AttributedJoinContractRow;
}

describe('subtreeJoinUnitsForLeaderMaintenanceInWindow', () => {
  const treeRows: OrgTreeRow[] = [
    row(LEADER_A, 'A', '리더', null, 0),
    row(LEADER_B, 'B', '리더', LEADER_A, 1),
    row(SALES_C, 'C', '영업사원', LEADER_B, 2),
  ];

  const start = '2026-06-26';
  const end = '2026-07-28';

  it('하위 리더 조직은 기본 제외', () => {
    const contracts = [
      contract('a1', LEADER_A, 5, '2026-07-01'),
      contract('b-post', LEADER_B, 10, '2026-07-25'),
      contract('c1', SALES_C, 8, '2026-07-25'),
    ];
    const units = subtreeJoinUnitsForLeaderMaintenanceInWindow({
      memberId: LEADER_A,
      treeRows,
      joinContractsAttributed: contracts,
      startInclusive: start,
      endInclusive: end,
    });
    assert.equal(units, 5);
  });

  it('하위 영업사원 승급 확정 계약까지는 상위 리더에 포함', () => {
    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: 'b-th',
      threshold_join_date: '2026-07-10',
      threshold_invoice_registered_at: '2026-07-10T05:00:00Z',
      threshold_created_at: '2026-07-10T04:00:00Z',
    };
    const contracts = [
      contract('a1', LEADER_A, 5, '2026-07-01'),
      contract('b-pre', LEADER_B, 9, '2026-07-05'),
      contract('b-th', LEADER_B, 1, '2026-07-10'),
      contract('b-post', LEADER_B, 4, '2026-07-20'),
      contract('c-post', SALES_C, 8, '2026-07-22'),
    ];
    const units = subtreeJoinUnitsForLeaderMaintenanceInWindow({
      memberId: LEADER_A,
      treeRows,
      joinContractsAttributed: contracts,
      startInclusive: start,
      endInclusive: end,
      promotionThresholdByMemberId: new Map([[LEADER_B, threshold]]),
    });
    // A(5) + B 승급 전(9) + 승급 확정(1) = 15. 승급 후 B/C 제외
    assert.equal(units, 15);
  });

  it('하위 리더 본인 유지장려 집계는 자기 조직 전체(컷 없음)', () => {
    const contracts = [
      contract('b1', LEADER_B, 6, '2026-07-01'),
      contract('c1', SALES_C, 7, '2026-07-02'),
    ];
    const units = subtreeJoinUnitsForLeaderMaintenanceInWindow({
      memberId: LEADER_B,
      treeRows,
      joinContractsAttributed: contracts,
      startInclusive: start,
      endInclusive: end,
    });
    assert.equal(units, 13);
  });
});
