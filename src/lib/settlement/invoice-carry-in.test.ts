import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  evaluateContractEligibility,
  findYearMonthForHappycallYmd,
  type ContractEligibilityInput,
} from './settlement-eligibility-v2';

/** TY018/TY01920260728 와 동일: 해피콜 7/28(7월 윈도우) + 송장 8/10 */
const julyHcAugustInvoice: ContractEligibilityInput = {
  id: 'ty018',
  status: '가입',
  is_cancelled: false,
  sales_member_id: '5e5b2174-91ce-49e3-9506-eb38d7e87043',
  sales_link_status: 'linked',
  happy_call_at: '2026-07-28 00:00:00+00',
  happycall_result: '성공',
  product_type: 'TY스페셜라이프케어',
  item_name: 'LG 코드제로',
  source_snapshot_json: { 상품명: 'TY스페셜라이프케어' },
  invoice_no: '설치완료 [-]',
  invoice_registered_at: '2026-08-10 02:19:13.79+00',
  settlement_deferred: false,
  deferred_to_month: null,
};

describe('findYearMonthForHappycallYmd', () => {
  it('2026-07-28 은 7월 정산 윈도우(마감 7/28)에 속한다', () => {
    assert.equal(findYearMonthForHappycallYmd('2026-07-28'), '2026-07');
  });

  it('2026-07-29 부터는 8월 정산 윈도우', () => {
    assert.equal(findYearMonthForHappycallYmd('2026-07-29'), '2026-08');
  });
});

describe('해피콜 7월·송장 8월 이월', () => {
  it('7월은 송장 마감 이후라 이월', () => {
    const d = evaluateContractEligibility(julyHcAugustInvoice, '2026-07');
    assert.equal(d.result, 'DEFERRED');
    if (d.result === 'DEFERRED') assert.equal(d.deferred_to_month, '2026-08');
  });

  it('이월 플래그가 없어도 8월 정산에 ELIGIBLE', () => {
    const d = evaluateContractEligibility(julyHcAugustInvoice, '2026-08');
    assert.equal(d.result, 'ELIGIBLE');
  });

  it('9월에는 이미 8월 귀속이라 제외', () => {
    const d = evaluateContractEligibility(julyHcAugustInvoice, '2026-09');
    assert.equal(d.result, 'EXCLUDED');
  });
});
