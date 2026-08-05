import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  computeCenterChiefThresholdForMember,
  compareSubtreeLeaderPromotionOrder,
  centerChiefPostRollupStartsYmd,
  isContractAtOrAfterCenterChiefPostRollup,
  mergeCenterChiefPromotionEventThresholds,
  splitContractUnitsByCenterChiefThreshold,
  CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE,
  type CenterChiefPromotionThreshold,
} from './center-chief-promotion';
import type { SalesMemberPromotionThreshold } from './leader-promotion';

const CENTER = 'center-leader';
const L1 = 'leader-1';
const L2 = 'leader-2';
const L3 = 'leader-3';
const L4 = 'leader-4';
const L5 = 'leader-5';
const L6 = 'leader-6';

function treeRows(): OrgTreeRow[] {
  return [
    { id: CENTER, name: 'Center', rank: '리더', parent_id: null, depth: 0 },
    { id: L1, name: 'L1', rank: '리더', parent_id: CENTER, depth: 1 },
    { id: L2, name: 'L2', rank: '리더', parent_id: CENTER, depth: 1 },
    { id: L3, name: 'L3', rank: '리더', parent_id: CENTER, depth: 1 },
    { id: L4, name: 'L4', rank: '리더', parent_id: CENTER, depth: 1 },
    { id: L5, name: 'L5', rank: '리더', parent_id: CENTER, depth: 1 },
    { id: L6, name: 'L6', rank: '리더', parent_id: CENTER, depth: 1 },
  ];
}

function rankById(): Map<string, RankType> {
  return new Map([
    [CENTER, '리더'],
    [L1, '리더'],
    [L2, '리더'],
    [L3, '리더'],
    [L4, '리더'],
    [L5, '리더'],
    [L6, '리더'],
  ]);
}

function leaderThreshold(
  memberId: string,
  date: string,
  contractId: string,
): SalesMemberPromotionThreshold {
  return {
    threshold_contract_id: contractId,
    threshold_join_date: date,
    threshold_invoice_registered_at: `${date}T10:00:00Z`,
    threshold_created_at: `${date}T10:00:01Z`,
  };
}

describe('center chief promotion', () => {
  it('산하 리더 5명 미만이면 threshold 없음', () => {
    const rows: OrgTreeRow[] = [
      { id: CENTER, name: 'C', rank: '리더', parent_id: null, depth: 0 },
      { id: L1, name: 'L1', rank: '리더', parent_id: CENTER, depth: 1 },
      { id: L2, name: 'L2', rank: '리더', parent_id: CENTER, depth: 1 },
    ];
    const ranks = new Map<string, RankType>([
      [CENTER, '리더'],
      [L1, '리더'],
      [L2, '리더'],
    ]);
    const th = computeCenterChiefThresholdForMember(CENTER, rows, ranks, new Map());
    assert.equal(th, null);
  });

  it('5번째 리더 승격 순서가 센터장 달성 경계', () => {
    const leaderPromotion = new Map<string, SalesMemberPromotionThreshold | null>([
      [L1, leaderThreshold(L1, '2026-03-01', 'c-l1')],
      [L2, leaderThreshold(L2, '2026-03-05', 'c-l2')],
      [L3, leaderThreshold(L3, '2026-03-10', 'c-l3')],
      [L4, leaderThreshold(L4, '2026-03-15', 'c-l4')],
      [L5, leaderThreshold(L5, '2026-06-20', 'c-l5')],
      [L6, leaderThreshold(L6, '2026-06-25', 'c-l6')],
    ]);

    assert.ok(compareSubtreeLeaderPromotionOrder(L1, L2, leaderPromotion) < 0);
    assert.ok(compareSubtreeLeaderPromotionOrder(L5, L6, leaderPromotion) < 0);

    const th = computeCenterChiefThresholdForMember(
      CENTER,
      treeRows(),
      rankById(),
      leaderPromotion,
    );
    assert.ok(th);
    assert.equal(th.threshold_leader_member_id, L5);
    assert.equal(th.threshold_join_date, '2026-06-20');
    assert.equal(th.threshold_contract_id, 'c-l5');
  });

  it('승급 계약 자체는 pre, 그 다음 계약부터 post (리더와 동일)', () => {
    const ccTh: CenterChiefPromotionThreshold = {
      threshold_leader_member_id: L5,
      threshold_join_date: '2026-06-20',
      threshold_contract_id: 'c-l5',
      threshold_invoice_registered_at: '2026-06-20T10:00:00Z',
      threshold_created_at: '2026-06-20T10:00:01Z',
    };

    assert.equal(centerChiefPostRollupStartsYmd(ccTh), '2026-06-20');

    const before = {
      id: 'before',
      join_date: '2026-06-19',
      happy_call_at: '2026-06-19',
      unit_count: 2,
    };
    const onThreshold = {
      id: 'c-l5',
      join_date: '2026-06-20',
      happy_call_at: '2026-06-20',
      invoice_registered_at: '2026-06-20T10:00:00Z',
      created_at: '2026-06-20T10:00:01Z',
      unit_count: 1,
    };
    const sameDayAfter = {
      id: 'same-day-after',
      join_date: '2026-06-20',
      happy_call_at: '2026-06-20',
      // 동일 해피콜일: created_at이 승급 계약보다 뒤면 post
      created_at: '2026-06-20T11:00:01Z',
      unit_count: 1,
    };
    const onNextDay = {
      id: 'next-day',
      join_date: '2026-06-21',
      happy_call_at: '2026-06-21',
      unit_count: 1,
    };

    assert.equal(isContractAtOrAfterCenterChiefPostRollup(before, ccTh), false);
    assert.equal(isContractAtOrAfterCenterChiefPostRollup(onThreshold, ccTh), false);
    assert.equal(isContractAtOrAfterCenterChiefPostRollup(sameDayAfter, ccTh), true);
    assert.equal(isContractAtOrAfterCenterChiefPostRollup(onNextDay, ccTh), true);

    assert.deepEqual(splitContractUnitsByCenterChiefThreshold(before, ccTh), {
      preCenterChiefUnits: 2,
      postCenterChiefUnits: 0,
    });
    assert.deepEqual(splitContractUnitsByCenterChiefThreshold(onThreshold, ccTh), {
      preCenterChiefUnits: 1,
      postCenterChiefUnits: 0,
    });
    assert.deepEqual(splitContractUnitsByCenterChiefThreshold(sameDayAfter, ccTh), {
      preCenterChiefUnits: 0,
      postCenterChiefUnits: 1,
    });
    assert.deepEqual(splitContractUnitsByCenterChiefThreshold(onNextDay, ccTh), {
      preCenterChiefUnits: 0,
      postCenterChiefUnits: 1,
    });
  });
});

describe('mergeCenterChiefPromotionEventThresholds', () => {
  it('이벤트 sentinel/계약 누락 시 5번째 리더 승급 threshold로 보정', () => {
    const map = new Map<string, CenterChiefPromotionThreshold | null>();
    const leaderTh: SalesMemberPromotionThreshold = {
      threshold_contract_id: 'c-leader5',
      threshold_join_date: '2026-07-28',
      threshold_created_at: '2026-07-28T10:00:00Z',
    };
    mergeCenterChiefPromotionEventThresholds(
      map,
      [
        {
          member_id: CENTER,
          threshold_leader_member_id: L5,
          threshold_join_date: CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE,
          threshold_contract_id: null,
        },
      ],
      new Map([
        [
          'c-leader5',
          {
            join_date: '2026-07-20',
            happy_call_at: '2026-07-28T01:00:00Z',
            created_at: '2026-07-28T10:00:00Z',
          },
        ],
      ]),
      new Map([[L5, leaderTh]]),
    );
    const th = map.get(CENTER);
    assert.ok(th);
    assert.equal(th!.threshold_leader_member_id, L5);
    assert.equal(th!.threshold_contract_id, 'c-leader5');
    assert.equal(th!.threshold_join_date, '2026-07-28');
  });

  it('보정 불가 sentinel 이벤트는 live compute를 덮어쓰지 않는다', () => {
    const live: CenterChiefPromotionThreshold = {
      threshold_leader_member_id: L5,
      threshold_join_date: '2026-07-27',
      threshold_contract_id: 'c-live',
    };
    const map = new Map<string, CenterChiefPromotionThreshold | null>([[CENTER, live]]);
    mergeCenterChiefPromotionEventThresholds(
      map,
      [
        {
          member_id: CENTER,
          threshold_leader_member_id: L6,
          threshold_join_date: CENTER_CHIEF_THRESHOLD_UNKNOWN_DATE,
          threshold_contract_id: null,
        },
      ],
      new Map(),
      new Map(),
    );
    assert.deepEqual(map.get(CENTER), live);
  });
});
