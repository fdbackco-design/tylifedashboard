import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { splitDivisionHeadRollupUnits } from './center-chief-rollup';
import type { DivisionHeadPromotionThreshold } from './division-head-promotion';

const dhTh: DivisionHeadPromotionThreshold = {
  threshold_center_chief_member_id: 'cc3',
  threshold_join_date: '2026-08-04',
  threshold_contract_id: null,
  threshold_created_at: '2026-08-04T01:58:25Z',
};

describe('division head rollup split', () => {
  it('본부장 승급 전 계약은 pre(센터장 차액), 이후는 post', () => {
    const before = splitDivisionHeadRollupUnits(
      {
        id: 'ty019',
        join_date: '2026-07-23',
        happy_call_at: '2026-07-23',
        created_at: '2026-07-23T10:00:00Z',
        unit_count: 1,
      },
      '사업본부장',
      dhTh,
    );
    assert.equal(before.preDivisionHeadUnits, 1);
    assert.equal(before.postDivisionHeadUnits, 0);

    const after = splitDivisionHeadRollupUnits(
      {
        id: 'ty999',
        join_date: '2026-08-05',
        happy_call_at: '2026-08-05',
        created_at: '2026-08-05T10:00:00Z',
        unit_count: 2,
      },
      '사업본부장',
      dhTh,
    );
    assert.equal(after.preDivisionHeadUnits, 0);
    assert.equal(after.postDivisionHeadUnits, 2);
  });
});
