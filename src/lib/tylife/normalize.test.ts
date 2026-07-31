import { describe, expect, it } from 'vitest';
import { normalizeProductType } from './normalize';

describe('normalizeProductType', () => {
  it('TY케어플랜을 별도 product_type으로 유지한다', () => {
    expect(normalizeProductType('TY케어플랜')).toBe('TY케어플랜');
    expect(normalizeProductType('신규 TY케어플랜 상품')).toBe('TY케어플랜');
  });
});
