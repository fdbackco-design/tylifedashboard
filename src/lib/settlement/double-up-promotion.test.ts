import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import {
  buildPromotionCommissionWalkForMember,
  collectLeaderPromotionApplyCandidates,
  computePromotionThresholdForMember,
  isLeaderMaintenanceBonusEligible,
  LEADER_PROMOTION_MIN_UNITS,
  promotionEligibleUnitsForContract,
  promotionMultiplierForContract,
  type AttributedJoinContractRow,
} from './leader-promotion';
import type { Contract } from '@/lib/types/contract';
import {
  calculateCenterChiefSubtreeBonus,
  subtreeSettlementUnitsForCenterChiefBonus,
} from './center-chief-bonus';
import {
  DOUBLE_UP_PROMOTION_END_YMD,
  DOUBLE_UP_PROMOTION_START_YMD,
  isDoubleUpPromotionWindow,
  promotionEligibleUnitsForContract as eligibleUnits,
} from './double-up-promotion';

const MEMBER = 'member-1';
const treeRows: OrgTreeRow[] = [
  { id: MEMBER, name: 'M', rank: '영업사원', parent_id: null, depth: 0 },
];

function row(
  id: string,
  units: number,
  happyCallYmd: string,
  productType: string = 'TY갤럭시케어',
): AttributedJoinContractRow {
  return {
    id,
    contract_code: id,
    status: '가입',
    join_date: happyCallYmd,
    unit_count: units,
    sales_member_id: MEMBER,
    happy_call_at: `${happyCallYmd}T12:00:00+09:00`,
    happycall_result: '성공',
    invoice_no: 'INV-1',
    product_type: productType,
  };
}

describe('double-up promotion window', () => {
  it('경계일: 6/25 ×1, 6/26~7/31 ×2, 8/1 ×1', () => {
    assert.equal(isDoubleUpPromotionWindow('2026-06-25T23:59:59+09:00'), false);
    assert.equal(isDoubleUpPromotionWindow('2026-06-26T00:00:00+09:00'), true);
    assert.equal(isDoubleUpPromotionWindow('2026-07-25T23:59:59+09:00'), true);
    assert.equal(isDoubleUpPromotionWindow('2026-07-26T00:00:00+09:00'), true);
    assert.equal(isDoubleUpPromotionWindow('2026-07-31T23:59:59+09:00'), true);
    assert.equal(isDoubleUpPromotionWindow('2026-08-01T00:00:00+09:00'), false);
    assert.equal(DOUBLE_UP_PROMOTION_START_YMD, '2026-06-26');
    assert.equal(DOUBLE_UP_PROMOTION_END_YMD, '2026-07-31');
  });

  it('해피콜 성공일 없으면 더블업 미적용', () => {
    assert.equal(
      promotionMultiplierForContract({
        unit_count: 2,
        happy_call_at: null,
        status: '가입',
        product_type: 'TY갤럭시케어',
      }),
      1,
    );
    assert.equal(
      eligibleUnits({
        unit_count: 2,
        happy_call_at: null,
        status: '가입',
        product_type: 'TY갤럭시케어',
      }),
      2,
    );
  });

  it('기간 내라도 갤럭시케어가 아니면 더블업 미적용', () => {
    assert.equal(promotionMultiplierForContract(row('lite', 2, '2026-07-10', '갤럭시케어 라이트')), 1);
    assert.equal(promotionMultiplierForContract(row('allife', 2, '2026-07-10', '올라이프케어')), 1);
    assert.equal(promotionMultiplierForContract(row('mu', 2, '2026-07-10', '무')), 2);
    assert.equal(promotionMultiplierForContract(row('ty', 2, '2026-07-10', 'TY갤럭시케어')), 2);
  });
});

describe('double-up eligible vs commission units', () => {
  const cases: Array<{ ymd: string; expectedEligible: number; expectedCommission: number }> = [
    { ymd: '2026-06-25', expectedEligible: 2, expectedCommission: 2 },
    { ymd: '2026-06-26', expectedEligible: 4, expectedCommission: 2 },
    { ymd: '2026-07-25', expectedEligible: 4, expectedCommission: 2 },
    { ymd: '2026-07-31', expectedEligible: 4, expectedCommission: 2 },
    { ymd: '2026-08-01', expectedEligible: 2, expectedCommission: 2 },
  ];

  for (const { ymd, expectedEligible, expectedCommission } of cases) {
    it(`${ymd} 해피콜 성공 2구좌 → 인정 ${expectedEligible} / 수당 ${expectedCommission}`, () => {
      const c = row('c1', 2, ymd);
      assert.equal(promotionEligibleUnitsForContract(c), expectedEligible);
      const { audit } = buildPromotionCommissionWalkForMember(MEMBER, treeRows, [c]);
      assert.equal(audit[0]?.unitCount, expectedCommission);
      assert.equal(audit[0]?.promotionEligibleUnitCount, expectedEligible);
      assert.equal(audit[0]?.commissionUnitCount, expectedCommission);
    });
  }
});

describe('double-up leader promotion threshold', () => {
  it('인정 20구좌로 승급 계약 도달 (실제 18구좌, 더블업으로 20 인정)', () => {
    const contracts: AttributedJoinContractRow[] = [];
    for (let i = 0; i < 8; i++) {
      contracts.push(row(`pre-${i}`, 2, '2026-06-01'));
    }
    contracts.push(row('double', 2, '2026-06-26'));

    const th = computePromotionThresholdForMember(MEMBER, treeRows, contracts, LEADER_PROMOTION_MIN_UNITS);
    assert.ok(th);
    assert.equal(th?.threshold_contract_id, 'double');

    let actualTotal = 0;
    let eligibleTotal = 0;
    for (const c of contracts) {
      actualTotal += c.unit_count;
      eligibleTotal += promotionEligibleUnitsForContract(c);
    }
    assert.equal(actualTotal, 18);
    assert.equal(eligibleTotal, 20);
  });

  it('인정 20구좌 달성 시 이벤트·직급 반영 후보 수집', () => {
    const contracts: AttributedJoinContractRow[] = [];
    for (let i = 0; i < 8; i++) {
      contracts.push(row(`pre-${i}`, 2, '2026-06-01'));
    }
    contracts.push(row('double', 2, '2026-06-26'));

    const parentByChild = new Map<string, string | null>([[MEMBER, null]]);
    const { rankUpMemberIds, eventRows } = collectLeaderPromotionApplyCandidates({
      treeRows,
      joinAttributed: contracts,
      members: [{ id: MEMBER, rank: '영업사원' }],
      parentByChild,
    });

    assert.deepEqual(rankUpMemberIds, [MEMBER]);
    assert.equal(eventRows.length, 1);
    assert.equal(eventRows[0]?.member_id, MEMBER);
    assert.equal(eventRows[0]?.threshold_contract_id, 'double');
    assert.equal(eventRows[0]?.threshold_join_date, '2026-06-26');
  });
});

describe('double-up bonus uses actual units only', () => {
  it('실제 10구좌·인정 20구좌 → 리더 보너스 미지급', () => {
    const eligible = isLeaderMaintenanceBonusEligible({
      memberDbRank: '영업사원',
      promotionThreshold: {
        threshold_contract_id: 'x',
        threshold_join_date: '2026-06-26',
      },
      subtreeJoinUnitsAsOf25: 10,
    });
    assert.equal(eligible, false);
  });

  it('실제 20구좌·인정 40구좌 → 리더 보너스 지급', () => {
    const eligible = isLeaderMaintenanceBonusEligible({
      memberDbRank: '영업사원',
      promotionThreshold: {
        threshold_contract_id: 'x',
        threshold_join_date: '2026-06-26',
      },
      subtreeJoinUnitsAsOf25: 20,
    });
    assert.equal(eligible, true);
  });

  it('산하 실제 50·인정 100 → 센터장 300만 보너스 미지급', () => {
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 50 }),
      0,
    );
  });

  it('산하 실제 100·인정 200 → 센터장 300만 보너스 지급', () => {
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 100 }),
      3_000_000,
    );
  });
});

describe('double-up commission uses eligible threshold + actual units', () => {
  it('인정 누적으로 승급 경계를 잡고, 수당 수량은 실제 구좌', () => {
    const contracts: AttributedJoinContractRow[] = [];
    for (let i = 0; i < 9; i++) {
      contracts.push(row(`a-${i}`, 2, '2026-06-01'));
    }
    contracts.push(row('promo', 2, '2026-06-26'));

    const { audit } = buildPromotionCommissionWalkForMember(MEMBER, treeRows, contracts);
    const last = audit[audit.length - 1];
    assert.equal(last?.contractId, 'promo');
    // 실제 18+2=20이지만, audit 누적은 인정구좌(18+4=22)
    assert.equal(last?.cumulativeUnitsBefore, 18);
    assert.equal(last?.cumulativeUnitsAfter, 22);
    assert.equal(last?.isPromotionContract, true);
    assert.equal(last?.promotionReason, 'PROMOTION_CONTRACT');
    assert.equal(last?.promotionEligibleUnitCount, 4);
    assert.equal(last?.unitCount, 2);
    assert.equal(last?.prePromotionUnits, 2);
    assert.equal(last?.postPromotionUnits, 0);
    assert.equal(last?.commissionPerUnit, 300_000);
  });

  it('더블업으로 리더 승급 후 다음 계약부터 실제 구좌 × 리더 단가', () => {
    // 목현화형: 실제 19구좌 + 더블업 2구좌(인정 4)로 승급 → 이후 계약은 40만
    const contracts: AttributedJoinContractRow[] = [
      ...Array.from({ length: 9 }, (_, i) => row(`pre-${i}`, 2, '2026-06-01')),
      row('pre-odd', 1, '2026-06-15'),
      row('TY062', 2, '2026-06-26'),
      row('TY288', 1, '2026-07-10'),
    ];

    const { audit, splitByContractId } = buildPromotionCommissionWalkForMember(
      MEMBER,
      treeRows,
      contracts,
    );

    const promo = audit.find((a) => a.contractId === 'TY062');
    assert.equal(promo?.cumulativeUnitsBefore, 19);
    assert.equal(promo?.cumulativeUnitsAfter, 23);
    assert.equal(promo?.promotionReason, 'PROMOTION_CONTRACT');
    assert.equal(promo?.unitCount, 2);
    assert.equal(promo?.commissionPerUnit, 300_000);
    assert.equal(splitByContractId.get('TY062')?.prePromotionUnits, 2);
    assert.equal(splitByContractId.get('TY062')?.postPromotionUnits, 0);

    const after = audit.find((a) => a.contractId === 'TY288');
    assert.equal(after?.promotionReason, 'AFTER_PROMOTION');
    assert.equal(after?.unitCount, 1);
    assert.equal(after?.commissionPerUnit, 400_000);
    assert.equal(splitByContractId.get('TY288')?.prePromotionUnits, 0);
    assert.equal(splitByContractId.get('TY288')?.postPromotionUnits, 1);
  });

  it('센터장 보너스 집계는 실제 정산 구좌만 (더블업 미반영)', () => {
    const CC = 'cc';
    const SALES = 'sales';
    const tree: OrgTreeRow[] = [
      { id: CC, name: 'CC', rank: '센터장', parent_id: null, depth: 0 },
      { id: SALES, name: 'S', rank: '영업사원', parent_id: CC, depth: 1 },
    ];
    const contractsByMember = new Map<string, Contract[]>([
      [
        SALES,
        [
          {
            id: 'c1',
            contract_code: 'c1',
            unit_count: 50,
            sales_member_id: SALES,
          } as Contract,
        ],
      ],
    ]);
    const units = subtreeSettlementUnitsForCenterChiefBonus({
      memberId: CC,
      treeRows: tree,
      contractsByMember,
    });
    assert.equal(units, 50);
  });
});
