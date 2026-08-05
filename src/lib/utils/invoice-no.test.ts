import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  hasJoinSatisfyingInvoiceNo,
  hasNumericInvoiceNo,
  hasSpecialLifeCareInstallCompleteInvoice,
  hasValidInvoiceNo,
  isTySpecialLifeCareProduct,
} from './invoice-no';

describe('invoice-no join satisfaction', () => {
  it('숫자 송장은 유효', () => {
    assert.equal(hasNumericInvoiceNo('44669296044 [-]'), true);
    assert.equal(hasValidInvoiceNo('44669296044 [-]'), true);
  });

  it('설치완료 마커 인식', () => {
    assert.equal(hasSpecialLifeCareInstallCompleteInvoice('설치완료 [true]'), true);
    assert.equal(hasSpecialLifeCareInstallCompleteInvoice('설치상품 [true]'), false);
    assert.equal(hasNumericInvoiceNo('설치완료 [true]'), false);
  });

  it('TY스페셜라이프케어는 설치완료만으로 가입 송장 충족', () => {
    const product = { product_type: 'TY스페셜라이프케어' };
    assert.equal(isTySpecialLifeCareProduct(product), true);
    assert.equal(hasJoinSatisfyingInvoiceNo('설치완료 [true]', product), true);
    assert.equal(hasJoinSatisfyingInvoiceNo('설치완료', product), true);
    assert.equal(hasJoinSatisfyingInvoiceNo(null, product), false);
    assert.equal(hasJoinSatisfyingInvoiceNo('44669296044', product), true);
  });

  it('다른 상품은 설치완료만으로 특별 처리하지 않고 기존 유효 송장 규칙', () => {
    // 기존 hasValidInvoiceNo 와 동일: 비어있지 않으면 true
    assert.equal(
      hasJoinSatisfyingInvoiceNo('설치완료 [true]', { product_type: 'TY갤럭시케어' }),
      true,
    );
    assert.equal(hasJoinSatisfyingInvoiceNo(null, { product_type: 'TY갤럭시케어' }), false);
  });
});
