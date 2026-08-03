import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  isTyCarePlanContract,
  isInvoiceExemptHappyCallJoinContract,
  meetsInvoiceExemptHappyCallJoinCondition,
} from './galaxy-care-mu';
import { evaluateContractEligibility, isV2EligibleStatic } from './settlement-eligibility-v2';
import { meetsInternalJoinCondition, resolveInternalContractStatus } from '@/lib/tylife/contract-internal-status';
import { getContractDisplayStatus } from '@/lib/utils/contract-display-status';

describe('TY케어플랜 가입 인정', () => {
  it('product_type / item_name 으로 케어플랜 식별', () => {
    assert.equal(isTyCarePlanContract({ product_type: 'TY케어플랜' }), true);
    assert.equal(isTyCarePlanContract({ item_name: 'TY케어플랜' }), true);
    assert.equal(isTyCarePlanContract({ product_type: 'TY갤럭시케어' }), false);
    assert.equal(
      isInvoiceExemptHappyCallJoinContract({ product_type: 'TY케어플랜' }),
      true,
    );
  });

  it('송장·렌탈 없이 해피콜 성공이면 가입 조건 충족', () => {
    const row = {
      product_type: 'TY케어플랜',
      item_name: 'TY케어플랜',
      invoice_no: null,
      happy_call_at: '2026-07-28',
      happycall_result: '성공',
      is_cancelled: false,
    };
    assert.equal(meetsInvoiceExemptHappyCallJoinCondition(row), true);
    assert.equal(meetsInternalJoinCondition(row), true);
    assert.equal(
      resolveInternalContractStatus({
        tySourceStatus: '준비',
        isCancelled: false,
        existingInternalStatus: '준비',
        invoice_no: null,
        happycall_result: '성공',
        happy_call_at: '2026-07-28',
        product_type: 'TY케어플랜',
        item_name: 'TY케어플랜',
      }),
      '가입',
    );
  });

  it('정산 v2: 송장 없어도 ELIGIBLE (해피콜 윈도우 안)', () => {
    const decision = evaluateContractEligibility(
      {
        id: 'c1',
        status: '준비',
        is_cancelled: false,
        sales_member_id: 'm1',
        sales_link_status: 'linked',
        happy_call_at: '2026-07-20',
        happycall_result: '성공',
        product_type: 'TY케어플랜',
        item_name: 'TY케어플랜',
        invoice_no: null,
        invoice_registered_at: null,
        settlement_deferred: false,
        deferred_to_month: null,
      },
      '2026-07',
    );
    assert.equal(decision.result, 'ELIGIBLE');
    if (decision.result === 'ELIGIBLE') {
      assert.equal(decision.happycall_ymd, '2026-07-20');
    }
  });

  it('정적 가입 인정·표시 상태도 가입', () => {
    const row = {
      status: '준비',
      is_cancelled: false,
      sales_member_id: 'm1',
      sales_link_status: 'linked' as const,
      product_type: 'TY케어플랜',
      item_name: 'TY케어플랜',
      invoice_no: null,
      happy_call_at: '2026-07-20',
      happycall_result: '성공',
    };
    assert.equal(isV2EligibleStatic(row), true);
    assert.equal(getContractDisplayStatus(row), '가입');
  });

  it('해피콜 없으면 가입 아님', () => {
    assert.equal(
      meetsInternalJoinCondition({
        product_type: 'TY케어플랜',
        invoice_no: null,
        happycall_result: null,
        happy_call_at: null,
      }),
      false,
    );
  });
});
