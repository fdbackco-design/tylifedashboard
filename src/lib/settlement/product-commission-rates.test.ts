import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  productCommissionPerUnitForRank,
  resolveProductCommissionKind,
} from './product-commission-rates';

describe('product commission kind', () => {
  it('물품명 TY썬크루즈 / TY스페셜라이프케어', () => {
    assert.equal(resolveProductCommissionKind({ item_name: 'TY썬크루즈' }), 'sun_cruise_or_special');
    assert.equal(
      resolveProductCommissionKind({ item_name: 'TY스페셜라이프케어' }),
      'sun_cruise_or_special',
    );
    assert.equal(
      resolveProductCommissionKind({ product_type: 'TY스페셜라이프케어' }),
      'sun_cruise_or_special',
    );
  });

  it('물품명 TY올라이프케어', () => {
    assert.equal(resolveProductCommissionKind({ item_name: 'TY올라이프케어' }), 'all_life');
    assert.equal(resolveProductCommissionKind({ product_type: '올라이프케어' }), 'all_life');
  });

  it('갤럭시케어 등은 미적용', () => {
    assert.equal(resolveProductCommissionKind({ item_name: '에코백스', product_type: 'TY갤럭시케어' }), null);
  });
});

describe('product commission rates by rank', () => {
  it('썬크루즈/스페셜: 25/30/35/40만', () => {
    const ref = { item_name: 'TY썬크루즈' };
    assert.equal(productCommissionPerUnitForRank('영업사원', ref), 250_000);
    assert.equal(productCommissionPerUnitForRank('리더', ref), 300_000);
    assert.equal(productCommissionPerUnitForRank('센터장', ref), 350_000);
    assert.equal(productCommissionPerUnitForRank('사업본부장', ref), 400_000);
  });

  it('올라이프: 25/35/42/45만', () => {
    const ref = { item_name: 'TY올라이프케어' };
    assert.equal(productCommissionPerUnitForRank('영업사원', ref), 250_000);
    assert.equal(productCommissionPerUnitForRank('리더', ref), 350_000);
    assert.equal(productCommissionPerUnitForRank('센터장', ref), 420_000);
    assert.equal(productCommissionPerUnitForRank('사업본부장', ref), 450_000);
  });

  it('미해당 상품은 null', () => {
    assert.equal(productCommissionPerUnitForRank('영업사원', { item_name: '기타' }), null);
  });
});
