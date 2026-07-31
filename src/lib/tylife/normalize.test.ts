import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITEM_NAME_PLACEHOLDER,
  normalizeItemNameForProduct,
  normalizeProductType,
} from './normalize';

describe('normalizeProductType', () => {
  it('TY케어플랜을 별도 product_type으로 유지한다', () => {
    expect(normalizeProductType('TY케어플랜')).toBe('TY케어플랜');
    expect(normalizeProductType('신규 TY케어플랜 상품')).toBe('TY케어플랜');
  });
});

describe('normalizeItemNameForProduct', () => {
  it('TY케어플랜은 상세 물품명이 들어와도 빈 값으로 유지한다', () => {
    expect(normalizeItemNameForProduct('TY케어플랜')).toBe('');
    expect(normalizeItemNameForProduct('TY케어플랜', DEFAULT_ITEM_NAME_PLACEHOLDER)).toBe('');
  });

  it('다른 상품은 상세 물품명 또는 기본값을 사용한다', () => {
    expect(normalizeItemNameForProduct('TY갤럭시케어')).toBe(DEFAULT_ITEM_NAME_PLACEHOLDER);
    expect(normalizeItemNameForProduct('TY갤럭시케어', '실제 물품')).toBe('실제 물품');
  });
});
