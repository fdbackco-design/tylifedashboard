import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  isAllLifeCareContract,
  isAllLifeCareMuContract,
  isTyGalaxyCareMuContract,
} from './galaxy-care-mu';

describe('isAllLifeCareContract / isTyGalaxyCareMuContract', () => {
  it('TY올라이프케어_무는 올라이프케어이며 갤럭시무가 아니다', () => {
    const c = {
      product_type: '무',
      source_snapshot_json: { 상품명: 'TY올라이프케어_무' },
    };
    assert.equal(isAllLifeCareContract(c), true);
    assert.equal(isAllLifeCareMuContract(c), true);
    assert.equal(isTyGalaxyCareMuContract(c), false);
  });

  it('TY갤럭시케어_무는 갤럭시무이다', () => {
    const c = {
      product_type: '무',
      source_snapshot_json: { 상품명: 'TY갤럭시케어_무' },
    };
    assert.equal(isAllLifeCareContract(c), false);
    assert.equal(isAllLifeCareMuContract(c), false);
    assert.equal(isTyGalaxyCareMuContract(c), true);
  });
});
