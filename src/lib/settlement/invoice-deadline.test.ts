import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  evaluateContractEligibility,
  getInvoiceDeadlineYmd,
  type ContractEligibilityInput,
} from './settlement-eligibility-v2';

describe('getInvoiceDeadlineYmd', () => {
  it('해당 월의 말일을 마감으로 쓴다', () => {
    assert.equal(getInvoiceDeadlineYmd('2026-04'), '2026-04-30');
    assert.equal(getInvoiceDeadlineYmd('2026-08'), '2026-08-31');
    assert.equal(getInvoiceDeadlineYmd('2026-02'), '2026-02-28');
    assert.equal(getInvoiceDeadlineYmd('2024-02'), '2024-02-29');
  });
});

describe('8월 말일 송장 등록', () => {
  const base: ContractEligibilityInput = {
    id: 'c1',
    status: '가입',
    is_cancelled: false,
    sales_member_id: 'm1',
    sales_link_status: 'linked',
    happy_call_at: '2026-08-14',
    happycall_result: '성공',
    product_type: '일반',
    item_name: '세탁기',
    source_snapshot_json: { 상품명: 'TY썬크루즈' },
    invoice_no: '설치완료 [-]',
    invoice_registered_at: '2026-08-31T02:20:19.307+00:00',
    settlement_deferred: false,
    deferred_to_month: null,
  };

  it('8월 31일 등록은 8월 정산에 ELIGIBLE', () => {
    const decision = evaluateContractEligibility(base, '2026-08');
    assert.equal(decision.result, 'ELIGIBLE');
  });

  it('9월 1일 등록은 8월에서 이월', () => {
    const decision = evaluateContractEligibility(
      { ...base, invoice_registered_at: '2026-09-01T00:00:00+09:00' },
      '2026-08',
    );
    assert.equal(decision.result, 'DEFERRED');
    if (decision.result === 'DEFERRED') {
      assert.equal(decision.deferred_to_month, '2026-09');
    }
  });
});
