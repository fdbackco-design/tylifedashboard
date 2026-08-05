import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { getContractDisplayProductName } from './contract-display-product';

describe('getContractDisplayProductName', () => {
  it('product_type이 일반이어도 스냅샷 상품명 TY케어플랜을 표시한다', () => {
    assert.equal(
      getContractDisplayProductName({
        product_type: '일반',
        item_name: '',
        source_snapshot_json: { 상품명: 'TY케어플랜' },
      }),
      'TY케어플랜',
    );
  });

  it('product_type TY케어플랜을 그대로 표시한다', () => {
    assert.equal(
      getContractDisplayProductName({
        product_type: 'TY케어플랜',
        item_name: '',
      }),
      'TY케어플랜',
    );
  });
});
