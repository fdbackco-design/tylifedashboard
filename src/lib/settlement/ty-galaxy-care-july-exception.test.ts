import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  evaluateContractEligibility,
  qualifiesTyGalaxyCareJuly2026WindowException,
  isTyGalaxyCareNamedProduct,
  type ContractEligibilityInput,
} from './settlement-eligibility-v2';

function base(overrides: Partial<ContractEligibilityInput> = {}): ContractEligibilityInput {
  return {
    id: 'c1',
    status: '가입',
    is_cancelled: false,
    sales_member_id: 'm1',
    sales_link_status: 'linked',
    happy_call_at: '2026-08-01',
    happycall_result: '성공',
    product_type: 'TY갤럭시케어',
    item_name: '헬스365',
    invoice_no: 'INV-1',
    invoice_registered_at: '2026-08-01',
    settlement_deferred: false,
    deferred_to_month: null,
    ...overrides,
  };
}

describe('TY갤럭시케어 7월 정산 윈도우 특례', () => {
  it('상품 식별: TY갤럭시케어 계열만 true (라이트 제외)', () => {
    assert.equal(isTyGalaxyCareNamedProduct({ product_type: 'TY갤럭시케어' }), true);
    assert.equal(
      isTyGalaxyCareNamedProduct({ source_snapshot_json: { 상품명: 'TY갤럭시케어_무' } }),
      true,
    );
    assert.equal(isTyGalaxyCareNamedProduct({ product_type: '무' }), true);
    assert.equal(isTyGalaxyCareNamedProduct({ product_type: '갤럭시케어 라이트' }), false);
    assert.equal(isTyGalaxyCareNamedProduct({ product_type: 'TY케어플랜' }), false);
  });

  it('가입 + 해피콜 6/26 이상이면 특례 대상', () => {
    assert.equal(
      qualifiesTyGalaxyCareJuly2026WindowException(
        { status: '가입', product_type: 'TY갤럭시케어' },
        '2026-06-26',
      ),
      true,
    );
    assert.equal(
      qualifiesTyGalaxyCareJuly2026WindowException(
        { status: '가입', product_type: 'TY갤럭시케어' },
        '2026-06-25',
      ),
      false,
    );
    assert.equal(
      qualifiesTyGalaxyCareJuly2026WindowException(
        { status: '준비', product_type: 'TY갤럭시케어' },
        '2026-08-01',
      ),
      false,
    );
  });

  it('7월: 해피콜이 7/28 이후여도 ELIGIBLE', () => {
    const decision = evaluateContractEligibility(base(), '2026-07');
    assert.equal(decision.result, 'ELIGIBLE');
  });

  it('7월: 윈도우 안(6/26~7/28)도 기존처럼 ELIGIBLE', () => {
    const decision = evaluateContractEligibility(
      base({ happy_call_at: '2026-07-10', invoice_registered_at: '2026-07-10' }),
      '2026-07',
    );
    assert.equal(decision.result, 'ELIGIBLE');
  });

  it('8월: 동일 계약은 7월 강제 포함으로 EXCLUDED', () => {
    const decision = evaluateContractEligibility(base(), '2026-08');
    assert.equal(decision.result, 'EXCLUDED');
    if (decision.result === 'EXCLUDED') {
      assert.match(decision.reason, /ty_galaxy_care_forced_to:2026-07/);
    }
  });

  it('준비 상태면 특례 미적용 → 7월 윈도우 밖은 EXCLUDED', () => {
    const decision = evaluateContractEligibility(base({ status: '준비' }), '2026-07');
    assert.equal(decision.result, 'EXCLUDED');
  });

  it('다른 상품은 특례 미적용', () => {
    const decision = evaluateContractEligibility(
      base({ product_type: 'TY케어플랜', item_name: 'TY케어플랜', invoice_no: null }),
      '2026-07',
    );
    assert.equal(decision.result, 'EXCLUDED');
  });
});
