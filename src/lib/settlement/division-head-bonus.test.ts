import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import type { Contract } from '@/lib/types/contract';
import {
  calculateDivisionHeadSubtreeBonus,
  divisionHeadSubtreeBonusForUnits,
  divisionHeadSubtreeBonusThreshold,
  subtreeSettlementUnitsForDivisionHeadBonus,
} from './division-head-bonus';

const HEAD = 'head-a';
const CC = 'cc-b';
const LEADER = 'leader-c';
const SALES = 'sales-d';
const OTHER_HEAD = 'head-e';

function contract(id: string, memberId: string, units: number): Contract {
  return {
    id,
    contract_code: id,
    unit_count: units,
    sales_member_id: memberId,
  } as Contract;
}

describe('division head subtree bonus', () => {
  it('사업본부장 + 산하 300구좌 이상 → 500만원', () => {
    assert.equal(divisionHeadSubtreeBonusThreshold(), 300);
    assert.equal(
      calculateDivisionHeadSubtreeBonus({ rank: '사업본부장', subtreeSettlementUnits: 300 }),
      5_000_000,
    );
    assert.equal(
      calculateDivisionHeadSubtreeBonus({ rank: '사업본부장', subtreeSettlementUnits: 400 }),
      5_000_000,
    );
  });

  it('299구좌 이하 또는 사업본부장이 아니면 0', () => {
    assert.equal(
      calculateDivisionHeadSubtreeBonus({ rank: '사업본부장', subtreeSettlementUnits: 299 }),
      0,
    );
    assert.equal(
      calculateDivisionHeadSubtreeBonus({ rank: '센터장', subtreeSettlementUnits: 400 }),
      0,
    );
  });

  it('divisionHeadSubtreeBonusForUnits는 직급 무관 구좌만 판정', () => {
    assert.equal(divisionHeadSubtreeBonusForUnits(299), 0);
    assert.equal(divisionHeadSubtreeBonusForUnits(300), 5_000_000);
  });

  it('하위 사업본부장 조직은 제외하고 센터장·리더 라인은 포함', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'H', rank: '사업본부장', parent_id: null, depth: 0 },
      { id: CC, name: 'CC', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: LEADER, name: 'L', rank: '리더', parent_id: CC, depth: 2 },
      { id: SALES, name: 'S', rank: '영업사원', parent_id: LEADER, depth: 3 },
      { id: OTHER_HEAD, name: 'OH', rank: '사업본부장', parent_id: HEAD, depth: 1 },
    ];
    const contractsByMember = new Map<string, Contract[]>([
      [HEAD, [contract('h1', HEAD, 10)]],
      [CC, [contract('c1', CC, 100)]],
      [LEADER, [contract('l1', LEADER, 80)]],
      [SALES, [contract('s1', SALES, 120)]],
      [OTHER_HEAD, [contract('oh1', OTHER_HEAD, 500)]],
    ]);

    const units = subtreeSettlementUnitsForDivisionHeadBonus({
      memberId: HEAD,
      treeRows,
      contractsByMember,
    });
    // H(10) + CC(100) + L(80) + S(120) = 310, OTHER_HEAD(500) 제외
    assert.equal(units, 310);
    assert.equal(
      calculateDivisionHeadSubtreeBonus({ rank: '사업본부장', subtreeSettlementUnits: units }),
      5_000_000,
    );
  });
});
