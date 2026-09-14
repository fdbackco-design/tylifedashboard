import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { extractConfirmedPayoutLinesFromDetail } from '@/lib/settlement/confirmed-payout-ledger';
import { isInternalClawbackExemptContractCode } from '@/lib/settlement/clawback-from-ledger';
import type { SettlementCalculationDetail } from '@/lib/types/settlement';

describe('confirmed payout ledger extract', () => {
  it('direct + rollup 라인을 수령자·계약별로 추출한다', () => {
    const detail = {
      year_month: '2026-07',
      member_id: 'm1',
      member_name: '임태순',
      rank: '센터장',
      rule_id: 'r1',
      direct_contracts: [
        {
          contract_id: 'c1',
          contract_code: 'TY23620260727',
          unit_count: 1,
          commission_per_unit: 300000,
          subtotal: 300000,
        },
      ],
      rollup_items: [],
      rollup_contract_items: [
        {
          contract_id: 'c2',
          contract_code: 'TY27720260724',
          from_member_id: 'm2',
          from_member_name: '이지현',
          from_rank: '리더',
          effective_sales_member_id: 'm2',
          unit_count: 1,
          rollup_amount_per_unit: 100000,
          subtotal: 100000,
        },
      ],
      incentive_applied: false,
      incentive_threshold: null,
      incentive_amount: 0,
    } as unknown as SettlementCalculationDetail;

    const lines = extractConfirmedPayoutLinesFromDetail(detail);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.amount_type, 'personal');
    assert.equal(lines[0]?.amount_won, 300000);
    assert.equal(lines[1]?.amount_type, 'rollup');
    assert.equal(lines[1]?.amount_won, 100000);
  });
});

describe('internal clawback exempt', () => {
  it('김복순 TY127/TY128 은 내부 환수 면제', () => {
    assert.equal(isInternalClawbackExemptContractCode('TY12720260716'), true);
    assert.equal(isInternalClawbackExemptContractCode('TY12820260716'), true);
    assert.equal(isInternalClawbackExemptContractCode('TY23620260727'), false);
  });
});
