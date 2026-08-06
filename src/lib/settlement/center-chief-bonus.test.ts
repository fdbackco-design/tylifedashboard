import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import type { Contract } from '@/lib/types/contract';
import {
  calculateCenterChiefSubtreeBonus,
  centerChiefSubtreeBonusForUnits,
  centerChiefSubtreeBonusThreshold,
  subtreeSettlementUnitsForCenterChiefBonus,
} from './center-chief-bonus';

const CC_A = 'cc-a';
const CC_B = 'cc-b';
const LEADER = 'leader-b';
const SALES = 'sales-c';

function contract(
  id: string,
  memberId: string,
  units: number,
  happyCallYmd = '2026-07-01',
): Contract {
  return {
    id,
    contract_code: id,
    unit_count: units,
    sales_member_id: memberId,
    join_date: happyCallYmd,
    happy_call_at: `${happyCallYmd}T03:00:00Z`,
    created_at: `${happyCallYmd}T04:00:00Z`,
  } as Contract;
}

describe('center chief subtree bonus', () => {
  it('센터장 + 산하 100구좌 이상 → 300만원', () => {
    assert.equal(centerChiefSubtreeBonusThreshold(), 100);
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 100 }),
      3_000_000,
    );
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 150 }),
      3_000_000,
    );
  });

  it('99구좌 이하 또는 센터장이 아니면 0', () => {
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 99 }),
      0,
    );
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '리더', subtreeSettlementUnits: 200 }),
      0,
    );
  });

  it('centerChiefSubtreeBonusForUnits는 직급 무관 구좌만 판정 (월중 본부장 승급 폴백용)', () => {
    assert.equal(centerChiefSubtreeBonusForUnits(99), 0);
    assert.equal(centerChiefSubtreeBonusForUnits(100), 3_000_000);
  });

  it('하위 센터장 조직은 집계에서 제외 (리더 유지장려금의 하위 리더 컷과 대칭)', () => {
    const treeRows: OrgTreeRow[] = [
      { id: CC_A, name: 'A', rank: '센터장', parent_id: null, depth: 0 },
      { id: LEADER, name: 'L', rank: '리더', parent_id: CC_A, depth: 1 },
      { id: SALES, name: 'S', rank: '영업사원', parent_id: LEADER, depth: 2 },
      { id: CC_B, name: 'B', rank: '센터장', parent_id: CC_A, depth: 1 },
    ];
    const contractsByMember = new Map<string, Contract[]>([
      [CC_A, [contract('a1', CC_A, 50)]],
      [LEADER, [contract('l1', LEADER, 30)]],
      [SALES, [contract('s1', SALES, 25)]],
      [CC_B, [contract('b1', CC_B, 200)]],
    ]);

    const units = subtreeSettlementUnitsForCenterChiefBonus({
      memberId: CC_A,
      treeRows,
      contractsByMember,
    });
    // A(50) + L(30) + S(25) = 105, CC_B(200) 제외
    assert.equal(units, 105);
    assert.equal(
      calculateCenterChiefSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: units }),
      3_000_000,
    );
  });

  it('하위 리더→센터장 승급 확정 계약까지는 상위 센터장 보너스에 포함', () => {
    const treeRows: OrgTreeRow[] = [
      { id: CC_A, name: 'A', rank: '센터장', parent_id: null, depth: 0 },
      { id: CC_B, name: 'B', rank: '센터장', parent_id: CC_A, depth: 1 },
      { id: SALES, name: 'S', rank: '영업사원', parent_id: CC_B, depth: 2 },
    ];
    const contractsByMember = new Map<string, Contract[]>([
      [CC_A, [contract('a1', CC_A, 40, '2026-07-01')]],
      [CC_B, [
        contract('b-pre', CC_B, 20, '2026-07-05'),
        contract('b-th', CC_B, 5, '2026-07-10'),
        contract('b-post', CC_B, 50, '2026-07-20'),
      ]],
      [SALES, [contract('s-post', SALES, 30, '2026-07-22')]],
    ]);

    const units = subtreeSettlementUnitsForCenterChiefBonus({
      memberId: CC_A,
      treeRows,
      contractsByMember,
      centerChiefThresholdByMemberId: new Map([
        [
          CC_B,
          {
            threshold_leader_member_id: 'fifth-leader',
            threshold_join_date: '2026-07-10',
            threshold_contract_id: 'b-th',
            threshold_created_at: '2026-07-10T04:00:00Z',
          },
        ],
      ]),
    });
    // A(40) + B 승급 전(20) + 승급 확정(5) = 65. 승급 후 B/S 제외
    assert.equal(units, 65);
  });
});
