import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildOrgStructuralTreeContext } from '@/lib/organization/org-structural-tree';
import {
  buildPromotionCommissionWalkForMember,
  type AttributedJoinContractRow,
} from '@/lib/settlement/leader-promotion';

describe('settlement walk org attribution', () => {
  const hqId = 'hq-1';
  const leaderId = 'leader-1';
  const salesId = 'sales-1';
  const customerMemberId = 'cust-member-1';
  const customerId = 'cust-uuid-1';

  const membersRaw = [
    { id: hqId, name: '안성준', rank: '본사', phone: null, external_id: null, source_customer_id: null },
    { id: leaderId, name: '리더', rank: '리더', phone: '01011112222', external_id: null, source_customer_id: null },
    {
      id: salesId,
      name: '영업',
      rank: '영업사원',
      phone: '01033334444',
      external_id: null,
      source_customer_id: null,
    },
    {
      id: customerMemberId,
      name: '고객영업',
      rank: '영업사원',
      phone: '01055556666',
      external_id: `customer:${customerId}`,
      source_customer_id: customerId,
    },
  ];

  const edgesRaw = [
    { parent_id: hqId, child_id: leaderId },
    { parent_id: leaderId, child_id: salesId },
    { parent_id: leaderId, child_id: customerMemberId },
  ];

  const ctx = buildOrgStructuralTreeContext({ membersRaw, edgesRaw });

  it('HQ 직계약 + 가입 인정 → 산하 고객(조직원) 노드 walk에 포함', () => {
    const rows: AttributedJoinContractRow[] = [
      {
        id: 'c1',
        join_date: '2026-06-01',
        unit_count: 1,
        sales_member_id: ctx.resolveSettlementWalkSalesMemberId({
          sales_member_id: hqId,
          settlement_sales_member_id: null,
          customer_id: customerId,
          status: '가입',
          customer_phone: '01055556666',
        }),
        happy_call_at: '2026-06-01',
        created_at: '2026-06-01T00:00:00Z',
      },
    ];

    const { audit: leaderAudit } = buildPromotionCommissionWalkForMember(
      leaderId,
      ctx.treeRows,
      rows,
    );
    assert.equal(leaderAudit.length, 1);
    assert.equal(rows[0]?.sales_member_id, customerMemberId);

    const { audit: salesAudit } = buildPromotionCommissionWalkForMember(
      salesId,
      ctx.treeRows,
      rows,
    );
    assert.equal(salesAudit.length, 0);
  });

  it('settlement_sales_member_id 보정 후 조직도 remap 적용', () => {
    const attributed = ctx.resolveSettlementWalkSalesMemberId({
      sales_member_id: hqId,
      settlement_sales_member_id: salesId,
      customer_id: 'unmapped-customer-id',
      status: '가입',
      customer_phone: null,
    });
    assert.equal(attributed, salesId);
  });
});
