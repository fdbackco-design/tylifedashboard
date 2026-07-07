import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  splitCenterChiefRollupUnits,
  centerChiefRollupSegmentLabel,
} from './center-chief-rollup';
import type { CenterChiefPromotionThreshold } from './center-chief-promotion';
import { getRollupAmountPerUnit } from './calculator';

const th: CenterChiefPromotionThreshold = {
  threshold_leader_member_id: 'leader-5',
  threshold_join_date: '2026-06-20',
  threshold_contract_id: 'c-l5',
};

describe('center chief rollup', () => {
  it('승급 확정일 당일까지 LEADER_BEFORE_CENTER, 다음날부터 CENTER_AFTER', () => {
    assert.equal(
      splitCenterChiefRollupUnits(
        { id: 'a', join_date: '2026-06-20', happy_call_at: '2026-06-20', unit_count: 1 },
        '센터장',
        th,
      ).preCenterChiefUnits,
      1,
    );
    assert.equal(
      splitCenterChiefRollupUnits(
        { id: 'b', join_date: '2026-06-21', happy_call_at: '2026-06-21', unit_count: 2 },
        '센터장',
        th,
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

  it('조명희 예시 — 직속 영업사원 20만, 직속 리더 라인 10만', () => {
    const rules: never[] = [];
    const d = '2026-06-30';
    assert.equal(getRollupAmountPerUnit('센터장', '영업사원', rules, d), 200_000);
    assert.equal(getRollupAmountPerUnit('센터장', '리더', rules, d), 100_000);
    assert.equal(getRollupAmountPerUnit('리더', '영업사원', rules, d), 100_000);
  });
});
