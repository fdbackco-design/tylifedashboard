import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import type { CenterChiefPromotionThreshold } from './center-chief-promotion';
import {
  computeDivisionHeadThresholdForMember,
  isContractAtOrAfterDivisionHeadPostRate,
} from './division-head-promotion';

const HEAD = 'head';
const CC1 = 'cc1';
const CC2 = 'cc2';
const CC3 = 'cc3';

describe('division head promotion rate boundary', () => {
  it('3번째 센터장 승급 계약 다음부터 본부장 단가', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'H', rank: '사업본부장', parent_id: null, depth: 0 },
      { id: CC1, name: 'A', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: CC2, name: 'B', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: CC3, name: 'C', rank: '센터장', parent_id: HEAD, depth: 1 },
    ];
    const rankById = new Map([
      [HEAD, '사업본부장' as const],
      [CC1, '센터장' as const],
      [CC2, '센터장' as const],
      [CC3, '센터장' as const],
    ]);
    const ccTh = new Map<string, CenterChiefPromotionThreshold | null>([
      [
        CC1,
        {
          threshold_leader_member_id: 'l1',
          threshold_join_date: '2026-07-01',
          threshold_contract_id: 'c1',
          threshold_created_at: '2026-07-01T10:00:00Z',
        },
      ],
      [
        CC2,
        {
          threshold_leader_member_id: 'l2',
          threshold_join_date: '2026-07-15',
          threshold_contract_id: 'c2',
          threshold_created_at: '2026-07-15T10:00:00Z',
        },
      ],
      [
        CC3,
        {
          threshold_leader_member_id: 'l3',
          threshold_join_date: '2026-07-27',
          threshold_contract_id: 'ty073',
          threshold_created_at: '2026-07-27T10:00:00Z',
        },
      ],
    ]);

    const dhTh = computeDivisionHeadThresholdForMember(HEAD, treeRows, rankById, ccTh);
    assert.ok(dhTh);
    assert.equal(dhTh!.threshold_center_chief_member_id, CC3);
    assert.equal(dhTh!.threshold_join_date, '2026-07-27');
    assert.equal(dhTh!.threshold_contract_id, 'ty073');

    const before = {
      id: 'ty108',
      join_date: '2026-07-03',
      happy_call_at: '2026-07-07',
      created_at: '2026-07-03T12:00:00Z',
    };
    const onThreshold = {
      id: 'ty073',
      join_date: '2026-07-27',
      happy_call_at: '2026-07-27',
      created_at: '2026-07-27T10:00:00Z',
    };
    const after = {
      id: 'ty999',
      join_date: '2026-07-28',
      happy_call_at: '2026-07-28',
      created_at: '2026-07-28T12:00:00Z',
    };

    assert.equal(isContractAtOrAfterDivisionHeadPostRate(before, dhTh), false);
    assert.equal(isContractAtOrAfterDivisionHeadPostRate(onThreshold, dhTh), false);
    assert.equal(isContractAtOrAfterDivisionHeadPostRate(after, dhTh), true);
  });

  it('9999-12-31 센터장 threshold는 created_at으로 정렬', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'H', rank: '사업본부장', parent_id: null, depth: 0 },
      { id: CC1, name: 'A', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: CC2, name: 'B', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: CC3, name: 'C', rank: '센터장', parent_id: HEAD, depth: 1 },
    ];
    const rankById = new Map([
      [HEAD, '사업본부장' as const],
      [CC1, '센터장' as const],
      [CC2, '센터장' as const],
      [CC3, '센터장' as const],
    ]);
    const ccTh = new Map<string, CenterChiefPromotionThreshold | null>([
      [
        CC1,
        {
          threshold_leader_member_id: 'l1',
          threshold_join_date: '9999-12-31',
          threshold_contract_id: null,
          threshold_created_at: '2026-07-31T09:32:46Z',
        },
      ],
      [
        CC2,
        {
          threshold_leader_member_id: 'l2',
          threshold_join_date: '9999-12-31',
          threshold_contract_id: null,
          threshold_created_at: '2026-08-04T01:58:25Z',
        },
      ],
      [
        CC3,
        {
          threshold_leader_member_id: 'l3',
          threshold_join_date: '2026-07-27',
          threshold_contract_id: 'ty073',
          threshold_created_at: '2026-07-27T10:00:00Z',
        },
      ],
    ]);

    const dhTh = computeDivisionHeadThresholdForMember(HEAD, treeRows, rankById, ccTh);
    // 정렬: CC3(07-27) → CC1(07-31) → CC2(08-04) → 3번째는 CC2
    assert.ok(dhTh);
    assert.equal(dhTh!.threshold_center_chief_member_id, CC2);
    assert.equal(dhTh!.threshold_join_date, '2026-08-04');

    const julyContract = {
      id: 'ty117',
      join_date: '2026-07-13',
      happy_call_at: '2026-07-15',
      created_at: '2026-07-13T12:00:00Z',
    };
    assert.equal(isContractAtOrAfterDivisionHeadPostRate(julyContract, dhTh), false);
  });
});
