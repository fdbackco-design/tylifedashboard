import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  splitCenterChiefRollupUnits,
  centerChiefRollupSegmentLabel,
} from './center-chief-rollup';
import {
  isContractAtOrAfterCenterChiefPostRollup,
  type CenterChiefPromotionThreshold,
} from './center-chief-promotion';
import {
  buildOrgTree,
  calculateMemberSettlement,
  getRollupAmountPerUnit,
} from './calculator';
import type { Contract } from '@/lib/types';
import type { SettlementRule } from '@/lib/types/settlement';
import type { OrgTreeRow } from '@/lib/types';

const th: CenterChiefPromotionThreshold = {
  threshold_leader_member_id: 'leader-5',
  threshold_join_date: '2026-06-20',
  threshold_contract_id: 'c-l5',
};

describe('center chief rollup', () => {
  it('승급 계약 자체는 pre, 다음 계약부터 CENTER_AFTER', () => {
    const thWithMeta: CenterChiefPromotionThreshold = {
      ...th,
      threshold_invoice_registered_at: '2026-06-20T10:00:00Z',
      threshold_created_at: '2026-06-20T10:00:01Z',
    };
    assert.equal(
      splitCenterChiefRollupUnits(
        {
          id: 'c-l5',
          join_date: '2026-06-20',
          happy_call_at: '2026-06-20',
          invoice_registered_at: '2026-06-20T10:00:00Z',
          created_at: '2026-06-20T10:00:01Z',
          unit_count: 1,
        },
        '센터장',
        thWithMeta,
      ).preCenterChiefUnits,
      1,
    );
    assert.equal(
      splitCenterChiefRollupUnits(
        {
          id: 'after',
          join_date: '2026-06-20',
          happy_call_at: '2026-06-20',
          created_at: '2026-06-20T11:00:00Z',
          unit_count: 2,
        },
        '센터장',
        thWithMeta,
      ).postCenterChiefUnits,
      2,
    );
    assert.equal(centerChiefRollupSegmentLabel('pre', '센터장'), 'LEADER_BEFORE_CENTER');
    assert.equal(centerChiefRollupSegmentLabel('post', '센터장'), 'CENTER_AFTER_PROMOTION');
  });

  it('threshold 없는 센터장은 전량 승급 전(리더 차액) 구간', () => {
    const split = splitCenterChiefRollupUnits(
      { id: 'x', join_date: '2026-07-01', unit_count: 3 },
      '센터장',
      null,
    );
    assert.equal(split.preCenterChiefUnits, 3);
    assert.equal(split.postCenterChiefUnits, 0);
  });

  it('DB 센터장 승급 전 — 직속 영업사원 라인 10만 (리더 단가 상한)', () => {
    const rules: never[] = [];
    const d = '2026-06-30';
    const leaderRate = 400_000;
    const salesRate = 300_000;
    assert.equal(getRollupAmountPerUnit('리더', '영업사원', rules, d), leaderRate - salesRate);
    // 승급 전 구간은 센터장도 리더 상한 − 하위와 동일 차액
    assert.equal(leaderRate - salesRate, 100_000);
  });

  it('동일 해피콜일: 송장시각이 승급계약보다 앞서면 created_at이 늦어도 pre', () => {
    const thWithMeta: CenterChiefPromotionThreshold = {
      threshold_leader_member_id: 'leader-5',
      threshold_join_date: '2026-07-28',
      threshold_contract_id: 'ty243',
      threshold_invoice_registered_at: '2026-08-04T01:46:25.985Z',
      threshold_created_at: '2026-07-27T14:09:15.721Z',
    };
    // TY244: created_at은 승급계약보다 늦지만 송장 등록이 더 빠름 → 리더 walk와 같이 pre
    assert.equal(
      isContractAtOrAfterCenterChiefPostRollup(
        {
          id: 'ty244',
          join_date: '2026-07-27',
          happy_call_at: '2026-07-28T00:00:00Z',
          invoice_registered_at: '2026-08-04T01:46:24.754Z',
          created_at: '2026-07-27T14:19:16.070Z',
        },
        thWithMeta,
      ),
      false,
    );
    assert.equal(
      isContractAtOrAfterCenterChiefPostRollup(
        {
          id: 'ty245',
          join_date: '2026-07-27',
          happy_call_at: '2026-07-28T00:00:00Z',
          invoice_registered_at: '2026-08-04T01:46:24.800Z',
          created_at: '2026-07-27T14:19:16.586Z',
        },
        thWithMeta,
      ),
      false,
    );
  });
});

describe('center chief direct commission boundary', () => {
  it('승급 계약 이전이면 리더 단가, 다음 계약부터 센터장 단가', () => {
    const ccTh: CenterChiefPromotionThreshold = {
      threshold_leader_member_id: 'leader-5',
      threshold_join_date: '2026-07-27',
      threshold_contract_id: 'c-l5',
      threshold_invoice_registered_at: '2026-07-27T10:00:00Z',
      threshold_created_at: '2026-07-27T10:00:01Z',
    };
    assert.equal(
      isContractAtOrAfterCenterChiefPostRollup(
        { id: 'ty073', join_date: '2026-07-17', happy_call_at: '2026-07-20' },
        ccTh,
      ),
      false,
    );
    assert.equal(
      isContractAtOrAfterCenterChiefPostRollup(
        {
          id: 'c-l5',
          join_date: '2026-07-27',
          happy_call_at: '2026-07-27',
          invoice_registered_at: '2026-07-27T10:00:00Z',
          created_at: '2026-07-27T10:00:01Z',
        },
        ccTh,
      ),
      false,
    );
    assert.equal(
      isContractAtOrAfterCenterChiefPostRollup(
        {
          id: 'after',
          join_date: '2026-07-27',
          happy_call_at: '2026-07-27',
          created_at: '2026-07-27T11:00:00Z',
        },
        ccTh,
      ),
      true,
    );
  });
});

describe('center chief rollup after subordinate leader promotion', () => {
  function rule(rank: SettlementRule['rank'], commission_per_unit: number): SettlementRule {
    return {
      id: `r-${rank}`,
      rank,
      base_amount_per_unit: 0,
      commission_per_unit,
      incentive_unit_threshold: null,
      incentive_amount: null,
      effective_from: '2020-01-01',
      effective_until: null,
      note: null,
      created_at: '2020-01-01T00:00:00.000Z',
    };
  }

  const rules: SettlementRule[] = [
    rule('영업사원', 300_000),
    rule('리더', 400_000),
    rule('센터장', 500_000),
  ];

  it('산하 리더 승급 이후에도 센터장 승급 다음 계약은 센터장 차액 롤업', () => {
    const centerId = 'center';
    const leaderId = 'leader-child';
    const salesId = 'sales';
    const rows: OrgTreeRow[] = [
      { id: centerId, name: '센터장', rank: '센터장', parent_id: null, depth: 0 },
      { id: leaderId, name: '리더', rank: '리더', parent_id: centerId, depth: 1 },
      { id: salesId, name: '영업', rank: '영업사원', parent_id: leaderId, depth: 2 },
    ];
    const tree = buildOrgTree(rows);
    const centerNode = tree.find((n) => n.id === centerId)!;

    const postContract = {
      id: 'c-post',
      contract_code: 'TY-POST',
      join_date: '2026-07-29',
      happy_call_at: '2026-07-28',
      unit_count: 1,
      sales_member_id: salesId,
      status: '가입',
      is_cancelled: false,
    } as Contract;

    // 산하 리더 walk: 해당 계약은 리더 승급 이후 → pre=0 (기존 상위 리더라면 제외될 계약)
    const leaderWalk = new Map([
      [postContract.id, { prePromotionUnits: 0, postPromotionUnits: 1 }],
    ]);
    const promotionUnitSplitByMemberId = new Map([[leaderId, leaderWalk]]);

    const ccTh: CenterChiefPromotionThreshold = {
      threshold_leader_member_id: 'l5',
      threshold_join_date: '2026-07-27',
      threshold_contract_id: 'c-l5',
    };

    const settle = calculateMemberSettlement(
      { id: centerId, name: '센터장', rank: '센터장' },
      [],
      centerNode,
      new Map([[salesId, [postContract]]]),
      rules,
      '2026-07',
      {
        treeRows: rows,
        promotionThresholdByMemberId: new Map(),
        joinOnlyAttributed: [],
        settlementEndDate: '2026-07-25',
        promotionUnitSplitByMemberId,
        centerChiefThresholdByMemberId: new Map([[centerId, ccTh]]),
      },
    );

    const hit = (settle.calculation_detail.rollup_contract_items ?? []).find(
      (r) => r.contract_code === 'TY-POST',
    );
    assert.ok(hit, '센터장 승급 이후 산하 계약이 롤업에 포함되어야 함');
    assert.equal(hit.rollup_amount_per_unit, 100_000); // 50만 − 직속 리더 40만
    assert.equal(hit.center_chief_rollup_segment, 'CENTER_AFTER_PROMOTION');
    assert.equal(hit.included_reason, 'center_chief_post_threshold');
  });
});
