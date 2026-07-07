import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildOrgTree, calculateMemberSettlement } from './calculator';
import type { Contract, SettlementRule } from '@/lib/types';
import type { OrgTreeRow } from '@/lib/types';
import { isParentOverrideActiveForYearMonth, type PreIssuedCodeMemberSetting } from './pre-issued-code-special';

function rule(rank: string, commission_per_unit: number): SettlementRule {
  return {
    id: `r-${rank}`,
    rank: rank as any,
    base_amount_per_unit: 0,
    commission_per_unit,
    incentive_unit_threshold: null,
    incentive_amount: null,
    effective_from: '2026-01-01',
    effective_until: null,
    note: null,
    created_at: new Date().toISOString(),
  };
}

function contract(id: string, sales_member_id: string, join_date: string, units: number): Contract {
  return {
    id,
    contract_code: id,
    sales_member_id,
    join_date,
    unit_count: units,
    happy_call_at: join_date,
    status: '가입',
    is_cancelled: false,
    sales_link_status: 'linked',
    invoice_no: 'INV-1',
    happycall_result: '성공',
  } as any;
}

function buildTreeRowsWithOverride(params: {
  memberId: string;
  overrideParentId: string;
  normalParentId: string | null;
  leaderA: string;
  leaderB: string;
  center: string;
}): OrgTreeRow[] {
  const { memberId, overrideParentId, normalParentId, leaderA, leaderB, center } = params;
  const parentForMember = overrideParentId ?? normalParentId;
  return [
    { id: center, name: '센터장', rank: '센터장', parent_id: null, depth: 0 },
    { id: leaderA, name: '리더A', rank: '리더', parent_id: center, depth: 1 },
    { id: leaderB, name: '리더B', rank: '리더', parent_id: center, depth: 1 },
    { id: memberId, name: '선발급', rank: '영업사원', parent_id: parentForMember, depth: 2 },
  ];
}

describe('month-end parent override integration (pre-issued code)', () => {
  it('월말 기준 활성 여부로 해당 월 전체 적용을 결정한다(중간 변경 분리 없음)', () => {
    const s: PreIssuedCodeMemberSetting = {
      id: 's1',
      member_id: 'm',
      parent_leader_member_id: 'A',
      reason: '코드 선발급',
      special_unit_price: 100000,
      special_unit_limit: 10,
      effective_from: '2026-07-20',
      effective_to: null,
      status: 'active',
      note: null,
    };
    // 7월 월말(7/31)은 from 이후 → 7월 전체 적용
    assert.equal(isParentOverrideActiveForYearMonth(s, '2026-07'), true);
    // 6월 월말(6/30)은 from 이전 → 6월 전체 미적용
    assert.equal(isParentOverrideActiveForYearMonth(s, '2026-06'), false);
  });

  it('7월 월말 A / 8월 월말 B → 해당 월 전체 롤업 귀속이 바뀐다', () => {
    const CENTER = 'C';
    const A = 'A';
    const B = 'B';
    const M = 'M';

    const rules: SettlementRule[] = [rule('영업사원', 300_000), rule('리더', 400_000), rule('센터장', 500_000)];

    // 7월: 월말 기준 상위리더 A
    const treeRowsJul = buildTreeRowsWithOverride({
      memberId: M,
      overrideParentId: A,
      normalParentId: null,
      leaderA: A,
      leaderB: B,
      center: CENTER,
    });
    const orgJul = buildOrgTree(treeRowsJul);
    const nodeAJul = orgJul.find((n) => n.id === A)!;
    const nodeBJul = orgJul.find((n) => n.id === B)!;

    const cJul = contract('jul-1', M, '2026-07-10', 10);
    const contractsByMemberJul = new Map<string, Contract[]>([[M, [cJul]]]);
    const settleAJul = calculateMemberSettlement(
      { id: A, name: '리더A', rank: '리더' as any },
      [],
      nodeAJul,
      contractsByMemberJul,
      rules,
      '2026-07',
      undefined,
    );
    const settleBJul = calculateMemberSettlement(
      { id: B, name: '리더B', rank: '리더' as any },
      [],
      nodeBJul,
      contractsByMemberJul,
      rules,
      '2026-07',
      undefined,
    );
    assert.equal(settleAJul.rollup_commission, 1_000_000); // (400-300)*10
    assert.equal(settleBJul.rollup_commission, 0);

    // 8월: 월말 기준 상위리더 B
    const treeRowsAug = buildTreeRowsWithOverride({
      memberId: M,
      overrideParentId: B,
      normalParentId: null,
      leaderA: A,
      leaderB: B,
      center: CENTER,
    });
    const orgAug = buildOrgTree(treeRowsAug);
    const nodeAAug = orgAug.find((n) => n.id === A)!;
    const nodeBAug = orgAug.find((n) => n.id === B)!;

    const cAug = contract('aug-1', M, '2026-08-10', 10);
    const contractsByMemberAug = new Map<string, Contract[]>([[M, [cAug]]]);
    const settleAAug = calculateMemberSettlement(
      { id: A, name: '리더A', rank: '리더' as any },
      [],
      nodeAAug,
      contractsByMemberAug,
      rules,
      '2026-08',
      undefined,
    );
    const settleBAug = calculateMemberSettlement(
      { id: B, name: '리더B', rank: '리더' as any },
      [],
      nodeBAug,
      contractsByMemberAug,
      rules,
      '2026-08',
      undefined,
    );
    assert.equal(settleAAug.rollup_commission, 0);
    assert.equal(settleBAug.rollup_commission, 1_000_000);
  });

  it('일반 영업자(설정 없음)는 기존 parent 기준으로 동일', () => {
    const CENTER = 'C';
    const A = 'A';
    const M = 'M';
    const rules: SettlementRule[] = [rule('영업사원', 300_000), rule('리더', 400_000), rule('센터장', 500_000)];

    const treeRows = [
      { id: CENTER, name: '센터장', rank: '센터장', parent_id: null, depth: 0 },
      { id: A, name: '리더A', rank: '리더', parent_id: CENTER, depth: 1 },
      { id: M, name: '일반', rank: '영업사원', parent_id: A, depth: 2 },
    ] as OrgTreeRow[];
    const org = buildOrgTree(treeRows);
    const nodeA = org.find((n) => n.id === A)!;
    const c = contract('x', M, '2026-07-10', 5);
    const contractsByMember = new Map<string, Contract[]>([[M, [c]]]);
    const settle = calculateMemberSettlement(
      { id: A, name: '리더A', rank: '리더' as any },
      [],
      nodeA,
      contractsByMember,
      rules,
      '2026-07',
      undefined,
    );
    assert.equal(settle.rollup_commission, 500_000);
  });
});

