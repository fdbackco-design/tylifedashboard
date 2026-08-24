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

  it('TY케어플랜은 수당 0원 상품군', () => {
    assert.equal(resolveProductCommissionKind({ product_type: 'TY케어플랜' }), 'care_plan_zero');
    assert.equal(
      resolveProductCommissionKind({
        product_type: '일반',
        source_snapshot_json: { 상품명: 'TY케어플랜' },
      }),
      'care_plan_zero',
    );
  });
});

describe('product commission rates by rank', () => {
  it('썬크루즈/스페셜 2026-08부터: 25/32/37/40만', () => {
    for (const item_name of ['TY썬크루즈', 'TY스페셜라이프케어'] as const) {
      const ref = { item_name };
      assert.equal(productCommissionPerUnitForRank('영업사원', ref, '2026-08'), 250_000);
      assert.equal(productCommissionPerUnitForRank('리더', ref, '2026-08'), 320_000);
      assert.equal(productCommissionPerUnitForRank('센터장', ref, '2026-08'), 370_000);
      assert.equal(productCommissionPerUnitForRank('사업본부장', ref, '2026-08'), 400_000);
      assert.equal(productCommissionPerUnitForRank('리더', ref, '2026-08-31'), 320_000);
    }
  });

  it('썬크루즈/스페셜 2026-07까지: 25/30/35/40만', () => {
    const ref = { item_name: 'TY썬크루즈' };
    assert.equal(productCommissionPerUnitForRank('영업사원', ref, '2026-07'), 250_000);
    assert.equal(productCommissionPerUnitForRank('리더', ref, '2026-07'), 300_000);
    assert.equal(productCommissionPerUnitForRank('센터장', ref, '2026-07'), 350_000);
    assert.equal(productCommissionPerUnitForRank('사업본부장', ref, '2026-07'), 400_000);
    assert.equal(productCommissionPerUnitForRank('리더', ref, '2026-07-31'), 300_000);
    assert.equal(productCommissionPerUnitForRank('센터장', ref, '2026-06'), 350_000);
  });

  it('올라이프: 25/35/42/45만 (월 무관)', () => {
    const ref = { item_name: 'TY올라이프케어' };
    assert.equal(productCommissionPerUnitForRank('영업사원', ref, '2026-07'), 250_000);
    assert.equal(productCommissionPerUnitForRank('리더', ref, '2026-07'), 350_000);
    assert.equal(productCommissionPerUnitForRank('센터장', ref, '2026-07'), 420_000);
    assert.equal(productCommissionPerUnitForRank('사업본부장', ref, '2026-07'), 450_000);
    assert.equal(productCommissionPerUnitForRank('리더', ref, '2026-08'), 350_000);
    assert.equal(productCommissionPerUnitForRank('센터장', ref, '2026-08'), 420_000);
  });

  it('TY케어플랜: 전 직급 0원', () => {
    const ref = { product_type: 'TY케어플랜' };
    assert.equal(productCommissionPerUnitForRank('영업사원', ref), 0);
    assert.equal(productCommissionPerUnitForRank('리더', ref), 0);
    assert.equal(productCommissionPerUnitForRank('센터장', ref), 0);
    assert.equal(productCommissionPerUnitForRank('사업본부장', ref), 0);
  });

  it('미해당 상품은 null', () => {
    assert.equal(productCommissionPerUnitForRank('영업사원', { item_name: '기타' }), null);
  });
});
