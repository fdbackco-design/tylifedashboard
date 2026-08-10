import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  isSpecialApplicableToContract,
  PRE_ISSUED_SPECIAL_UNIT_PRICE_ENABLED,
  splitDirectContractByPreIssuedSpecial,
  type PreIssuedCodeMemberSetting,
} from './pre-issued-code-special';
import { promotionEligibleUnitsForContract } from './double-up-promotion';

const setting: PreIssuedCodeMemberSetting = {
  id: 's1',
  member_id: 'm1',
  parent_leader_member_id: 'p1',
  reason: '코드 선발급',
  special_unit_price: 100_000,
  special_unit_limit: 10,
  effective_from: '2026-06-01',
  effective_to: null,
  status: 'active',
  note: null,
};

describe('pre-issued code special split', () => {
  it('특례 단가 예외는 비활성(일반 직급 단가 지급)', () => {
    assert.equal(PRE_ISSUED_SPECIAL_UNIT_PRICE_ENABLED, false);
    assert.equal(
      isSpecialApplicableToContract({
        setting,
        contractOrderYmd: '2026-07-10',
        memberId: 'm1',
        contractSalesMemberId: 'm1',
      }),
      false,
    );
  });

  it('실제 1구좌 판매 → 1구좌 특례 10만원', () => {
    const r = splitDirectContractByPreIssuedSpecial({
      contractUnitCount: 1,
      specialConsumedBefore: 0,
      setting,
      normalUnitPrice: 300_000,
    });
    assert.equal(r.special_units, 1);
    assert.equal(r.normal_units, 0);
    assert.equal(r.special_amount, 100_000);
    assert.equal(r.normal_amount, 0);
    assert.equal(r.remaining_special_units_after, 9);
  });

  it('실제 10구좌 판매 → 특례 수당 100만원, 남은 0', () => {
    const r = splitDirectContractByPreIssuedSpecial({
      contractUnitCount: 10,
      specialConsumedBefore: 0,
      setting,
      normalUnitPrice: 300_000,
    });
    assert.equal(r.special_units, 10);
    assert.equal(r.special_amount, 1_000_000);
    assert.equal(r.remaining_special_units_after, 0);
  });

  it('잔여 3구좌 상태에서 실제 5구좌 계약 → 3구좌 특례 + 2구좌 일반 단가', () => {
    const r = splitDirectContractByPreIssuedSpecial({
      contractUnitCount: 5,
      specialConsumedBefore: 7,
      setting,
      normalUnitPrice: 300_000,
    });
    assert.equal(r.special_units, 3);
    assert.equal(r.normal_units, 2);
    assert.equal(r.special_amount, 300_000);
    assert.equal(r.normal_amount, 600_000);
    assert.equal(r.remaining_special_units_after, 0);
  });

  it('더블업 기간 실제 10구좌 → 승급 인정 20이지만 특례 소진은 10', () => {
    const eligible = promotionEligibleUnitsForContract({
      unit_count: 10,
      happy_call_at: '2026-07-10T12:00:00+09:00',
      happycall_result: '성공',
      status: '가입',
      product_type: 'TY갤럭시케어',
    });
    assert.equal(eligible, 20);

    const r = splitDirectContractByPreIssuedSpecial({
      contractUnitCount: 10,
      specialConsumedBefore: 0,
      setting,
      normalUnitPrice: 300_000,
    });
    assert.equal(r.special_units_after, 10);
    assert.equal(r.remaining_special_units_after, 0);
  });
});

