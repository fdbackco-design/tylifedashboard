import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  isForceCancelledContractCode,
  mergeExistingContractFields,
  resolveInternalContractStatus,
} from './contract-internal-status';
import type { ContractInsert } from '../types/contract';

describe('force-cancelled contract codes', () => {
  it('TY127/TY128/TY009/TY010은 강제 취소 allowlist에 포함', () => {
    assert.equal(isForceCancelledContractCode('TY12720260716'), true);
    assert.equal(isForceCancelledContractCode('TY12820260716'), true);
    assert.equal(isForceCancelledContractCode('TY00920260719'), true);
    assert.equal(isForceCancelledContractCode('TY01020260719'), true);
  });

  it('TY 원본이 가입이어도 내부 status는 취소', () => {
    for (const contractCode of ['TY12820260716', 'TY00920260719', 'TY01020260719'] as const) {
      const status = resolveInternalContractStatus({
        tySourceStatus: '가입',
        isCancelled: false,
        existingInternalStatus: '가입',
        invoice_no: '123456789012',
        happycall_result: '완료',
        happy_call_at: '2026-07-16T00:00:00Z',
        contractCode,
      });
      assert.equal(status, '취소', contractCode);
    }
  });

  it('mergeExistingContractFields도 is_cancelled를 true로 고정', () => {
    for (const contract_code of ['TY12720260716', 'TY00920260719', 'TY01020260719'] as const) {
      const incoming = {
        contract_code,
        status: '가입',
        is_cancelled: false,
        customer_id: 'x',
        join_date: '2026-07-16',
        product_type: 'TY갤럭시케어',
      } as ContractInsert;
      const merged = mergeExistingContractFields(incoming, {
        status: '가입',
        invoice_no: null,
        rental_request_no: null,
        item_name: null,
        happycall_result: null,
        is_cancelled: false,
      });
      assert.equal(merged.is_cancelled, true, contract_code);
    }
  });
});
