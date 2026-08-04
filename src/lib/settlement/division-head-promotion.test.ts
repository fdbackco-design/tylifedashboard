import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import type { RankType } from '@/lib/types/organization';
import {
  computeDivisionHeadPromotionMemberIds,
  computeDivisionHeadDemotionMemberIds,
  DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS,
} from './leader-promotion';

const HEAD = 'division-candidate';
const C1 = 'center-1';
const C2 = 'center-2';
const C3 = 'center-3';
const C4 = 'center-4';
const L1 = 'leader-1';

function ranks(entries: Array<[string, RankType]>): Map<string, RankType> {
  return new Map(entries);
}

describe('division head promotion', () => {
  it(`산하 센터장 ${DIVISION_HEAD_PROMOTION_MIN_CENTER_CHIEFS}명 이상이면 사업본부장 승격`, () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'Head', rank: '센터장', parent_id: null, depth: 0 },
      { id: C1, name: 'C1', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C2, name: 'C2', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C3, name: 'C3', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: L1, name: 'L1', rank: '리더', parent_id: HEAD, depth: 1 },
    ];
    const rankById = ranks([
      [HEAD, '센터장'],
      [C1, '센터장'],
      [C2, '센터장'],
      [C3, '센터장'],
      [L1, '리더'],
    ]);

    const promoted = computeDivisionHeadPromotionMemberIds(treeRows, rankById);
    assert.deepEqual(promoted, [HEAD]);
  });

  it('산하 센터장 2명이면 승격하지 않음', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'Head', rank: '센터장', parent_id: null, depth: 0 },
      { id: C1, name: 'C1', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C2, name: 'C2', rank: '센터장', parent_id: HEAD, depth: 1 },
    ];
    const rankById = ranks([
      [HEAD, '센터장'],
      [C1, '센터장'],
      [C2, '센터장'],
    ]);

    assert.deepEqual(computeDivisionHeadPromotionMemberIds(treeRows, rankById), []);
  });

  it('손자 노드 센터장도 산하 인원에 포함', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'Head', rank: '센터장', parent_id: null, depth: 0 },
      { id: L1, name: 'L1', rank: '리더', parent_id: HEAD, depth: 1 },
      { id: C1, name: 'C1', rank: '센터장', parent_id: L1, depth: 2 },
      { id: C2, name: 'C2', rank: '센터장', parent_id: L1, depth: 2 },
      { id: C3, name: 'C3', rank: '센터장', parent_id: L1, depth: 2 },
    ];
    const rankById = ranks([
      [HEAD, '센터장'],
      [L1, '리더'],
      [C1, '센터장'],
      [C2, '센터장'],
      [C3, '센터장'],
    ]);

    assert.deepEqual(computeDivisionHeadPromotionMemberIds(treeRows, rankById), [HEAD]);
  });

  it('customer 가상 센터장은 산하 인원에서 제외', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'Head', rank: '센터장', parent_id: null, depth: 0 },
      { id: C1, name: 'C1', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C2, name: 'C2', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C3, name: 'C3', rank: '센터장', parent_id: HEAD, depth: 1 },
    ];
    const rankById = ranks([
      [HEAD, '센터장'],
      [C1, '센터장'],
      [C2, '센터장'],
      [C3, '센터장'],
    ]);
    const externalIdByMemberId = new Map<string, string | null>([
      [HEAD, 'm-head'],
      [C1, 'm-c1'],
      [C2, 'm-c2'],
      [C3, 'customer:abc'],
    ]);

    assert.deepEqual(
      computeDivisionHeadPromotionMemberIds(treeRows, rankById, externalIdByMemberId),
      [],
    );
  });

  it('산하 센터장 부족 시 사업본부장 강등', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'Head', rank: '사업본부장', parent_id: null, depth: 0 },
      { id: C1, name: 'C1', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C2, name: 'C2', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C4, name: 'C4', rank: '리더', parent_id: HEAD, depth: 1 },
    ];
    const rankById = ranks([
      [HEAD, '사업본부장'],
      [C1, '센터장'],
      [C2, '센터장'],
      [C4, '리더'],
    ]);

    assert.deepEqual(computeDivisionHeadDemotionMemberIds(treeRows, rankById), [HEAD]);
  });

  it('산하 센터장 3명 이상이면 사업본부장 유지(강등 없음)', () => {
    const treeRows: OrgTreeRow[] = [
      { id: HEAD, name: 'Head', rank: '사업본부장', parent_id: null, depth: 0 },
      { id: C1, name: 'C1', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C2, name: 'C2', rank: '센터장', parent_id: HEAD, depth: 1 },
      { id: C3, name: 'C3', rank: '센터장', parent_id: HEAD, depth: 1 },
    ];
    const rankById = ranks([
      [HEAD, '사업본부장'],
      [C1, '센터장'],
      [C2, '센터장'],
      [C3, '센터장'],
    ]);

    assert.deepEqual(computeDivisionHeadDemotionMemberIds(treeRows, rankById), []);
  });
});
