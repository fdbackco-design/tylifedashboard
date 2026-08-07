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

  const ctx = buildOrgStructuralTreeContext({
    membersRaw,
    edgesRaw,
    customerBirthDateById: new Map([[customerId, '1990-01-01']]),
  });

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
          customer_name: '고객영업',
          customer_birth_date: '1990-01-01',
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

  it('동명이인 고객 노드와 리더 노드를 분리해 상위 영업사원 승급 walk를 오염시키지 않는다', () => {
    const kimId = 'kim-yunjung';
    const customerParkId = 'customer-park';
    const leaderParkId = 'leader-park';
    const otherParentId = 'other-parent';
    const customerParkCustomerId = 'customer-park-customer';
    const leaderParkCustomerId = 'leader-park-customer';
    const homonymCtx = buildOrgStructuralTreeContext({
      membersRaw: [
        { id: kimId, name: '김윤정', rank: '영업사원', phone: '01041175624', external_id: 'cust:kim', source_customer_id: 'kim' },
        { id: otherParentId, name: '조명희', rank: '센터장', phone: '01000000001', external_id: 'cust:parent', source_customer_id: 'parent' },
        { id: leaderParkId, name: '박미선', rank: '리더', phone: '01057656850', external_id: `cust:${leaderParkCustomerId}`, source_customer_id: leaderParkCustomerId },
        { id: customerParkId, name: '[고객] 박미선', rank: '영업사원', phone: '01071707562', external_id: `customer:${customerParkCustomerId}`, source_customer_id: customerParkCustomerId },
      ],
      edgesRaw: [
        { parent_id: otherParentId, child_id: kimId },
        { parent_id: otherParentId, child_id: leaderParkId },
        { parent_id: kimId, child_id: customerParkId },
      ],
      customerBirthDateById: new Map([
        ['kim', '1990-01-01'],
        ['parent', '1970-01-01'],
        [leaderParkCustomerId, '1986-04-13'],
        [customerParkCustomerId, '1980-08-11'],
      ]),
    });
    const rows: AttributedJoinContractRow[] = [
      {
        id: 'customer-park-contract',
        join_date: '2026-07-23',
        unit_count: 2,
        sales_member_id: customerParkId,
      },
      {
        id: 'leader-park-contract',
        join_date: '2026-07-15',
        unit_count: 20,
        sales_member_id: leaderParkId,
      },
    ];

    const { audit } = buildPromotionCommissionWalkForMember(kimId, homonymCtx.treeRows, rows);

    assert.deepEqual(audit.map((row) => row.contractId), ['customer-park-contract']);
    assert.equal(homonymCtx.remapMemberId(customerParkId), customerParkId);
    assert.equal(homonymCtx.treeRows.find((row) => row.id === leaderParkId)?.parent_id, otherParentId);
  });

  it('정성훈 split: HQ settlement override여도 다른 담당자 계약은 고객노드(송영희 산하) walk에 넣지 않는다', () => {
    const jungCustomerId = 'f21273ec-f980-4ac0-b16c-bf6ae4e7a606';
    const songId = 'song-younghee';
    const jaewonId = 'lee-jaewon';
    const jungMemberId = 'jung-sunghoon-node';
    const splitCtx = buildOrgStructuralTreeContext({
      membersRaw: [
        { id: hqId, name: '안성준', rank: '본사', phone: null, external_id: null, source_customer_id: null },
        { id: songId, name: '송영희', rank: '리더', phone: null, external_id: null, source_customer_id: null },
        { id: jaewonId, name: '이재원', rank: '센터장', phone: null, external_id: null, source_customer_id: null },
        {
          id: jungMemberId,
          name: '정성훈',
          rank: '영업사원',
          phone: '01099998888',
          external_id: `customer:${jungCustomerId}`,
          source_customer_id: jungCustomerId,
        },
      ],
      edgesRaw: [
        { parent_id: hqId, child_id: songId },
        { parent_id: hqId, child_id: jaewonId },
        { parent_id: songId, child_id: jungMemberId },
      ],
      customerBirthDateById: new Map([[jungCustomerId, '1980-01-01']]),
    });

    const mayToJaewon = splitCtx.resolveSettlementWalkSalesMemberId({
      sales_member_id: jaewonId,
      settlement_sales_member_id: hqId,
      customer_id: jungCustomerId,
      status: '가입',
      customer_name: '정성훈',
      customer_phone: '01099998888',
      customer_birth_date: '1980-01-01',
    });
    assert.equal(mayToJaewon, jaewonId);

    const julyUnderSong = splitCtx.resolveSettlementWalkSalesMemberId({
      sales_member_id: songId,
      settlement_sales_member_id: null,
      customer_id: jungCustomerId,
      status: '가입',
      customer_name: '정성훈',
      customer_phone: '01099998888',
      customer_birth_date: '1980-01-01',
    });
    assert.equal(julyUnderSong, jungMemberId);
  });
});
