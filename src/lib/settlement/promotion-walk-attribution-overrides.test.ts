import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildOrgStructuralTreeContext } from '@/lib/organization/org-structural-tree';
import {
  applyPromotionWalkSalesMemberOverride,
  buildMemberIdByNameMap,
  PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE,
} from '@/lib/settlement/promotion-walk-attribution-overrides';

describe('promotion walk attribution overrides', () => {
  it('maps TY152/TY153 to 임혜진 by name', () => {
    assert.equal(PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE.TY15220260519, '임혜진');
    assert.equal(PROMOTION_WALK_MEMBER_NAME_BY_CONTRACT_CODE.TY15320260519, '임혜진');
  });

  it('applyPromotionWalkSalesMemberOverride remaps only listed codes', () => {
    const memberIdByName = buildMemberIdByNameMap([
      { id: 'kim', name: '김중권' },
      { id: 'im', name: '임혜진' },
    ]);
    assert.equal(
      applyPromotionWalkSalesMemberOverride({
        contract_code: 'TY15220260519',
        attributedMemberId: 'kim',
        memberIdByName,
      }),
      'im',
    );
    assert.equal(
      applyPromotionWalkSalesMemberOverride({
        contract_code: 'TY99920260101',
        attributedMemberId: 'kim',
        memberIdByName,
      }),
      'kim',
    );
  });

  it('resolveSettlementWalkSalesMemberId applies override without changing sales remap base', () => {
    const hqId = 'hq';
    const joId = 'jo';
    const kimId = 'kim';
    const imId = 'im';
    const kimCustomerId = 'cust-kim';

    const membersRaw = [
      { id: hqId, name: '안성준', rank: '본사', phone: null, external_id: null, source_customer_id: null },
      { id: joId, name: '조명희', rank: '센터장', phone: null, external_id: null, source_customer_id: null },
      {
        id: kimId,
        name: '김중권',
        rank: '영업사원',
        phone: '01077247970',
        external_id: `cust:${kimCustomerId}`,
        source_customer_id: kimCustomerId,
      },
      {
        id: imId,
        name: '임혜진',
        rank: '리더',
        phone: null,
        external_id: null,
        source_customer_id: null,
      },
    ];
    const edgesRaw = [
      { parent_id: hqId, child_id: joId },
      { parent_id: joId, child_id: kimId },
      { parent_id: joId, child_id: imId },
    ];

    const ctx = buildOrgStructuralTreeContext({ membersRaw, edgesRaw });

    const baseInput = {
      sales_member_id: joId,
      settlement_sales_member_id: joId,
      customer_id: kimCustomerId,
      status: '가입',
      invoice_no: '설치상품',
      customer_name: '김중권',
      customer_phone: '01077247970',
      contract_code: 'TY15220260519',
    };

    const salesRemap = ctx.resolveContractSalesMemberId(baseInput);
    // 자기구매 remap이면 김중권, 아니면 담당자(조명희) — 어느 쪽이든 walk override는 임혜진
    assert.ok(salesRemap === kimId || salesRemap === joId);
    assert.equal(ctx.resolveSettlementWalkSalesMemberId(baseInput), imId);
    assert.equal(
      ctx.resolveSettlementWalkSalesMemberId({ ...baseInput, contract_code: 'TY15320260519' }),
      imId,
    );
    // 정산/조직 remap 함수 자체는 override를 적용하지 않는다
    assert.notEqual(ctx.resolveContractSalesMemberId(baseInput), imId);
  });
});
