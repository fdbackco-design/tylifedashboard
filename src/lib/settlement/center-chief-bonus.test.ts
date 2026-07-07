import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  calculateCenterChiefSubtreeBonus,
  centerChiefSubtreeBonusThreshold,
} from './center-chief-bonus';

describe('center chief subtree bonus', () => {
  it('센터장 + 산하 100구좌 이상 → 300만원', () => {
    assert.equal(centerChiefSubtreeBonusThreshold(), 100);
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 100 }),
      3_000_000,
    );
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 150 }),
      3_000_000,
    );
  });

  it('99구좌 이하 또는 센터장이 아니면 0', () => {
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 99 }),
      0,
    );
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '리더', subtreeSettlementUnits: 200 }),
      0,
    );
  });
});
