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

  it('TY올라이프케어를 canonical product_type으로 정규화한다', () => {
    expect(normalizeProductType('TY올라이프케어')).toBe('TY올라이프케어');
    expect(normalizeProductType('올라이프케어')).toBe('TY올라이프케어');
  });

  it('TY올라이프케어_무는 갤럭시무가 아니라 TY올라이프케어로 저장한다', () => {
    expect(normalizeProductType('TY올라이프케어_무')).toBe('TY올라이프케어');
  });

  it('TY갤럭시케어_무만 product_type 무로 정규화한다', () => {
    expect(normalizeProductType('TY갤럭시케어_무')).toBe('무');
    expect(normalizeProductType('무')).toBe('무');
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
