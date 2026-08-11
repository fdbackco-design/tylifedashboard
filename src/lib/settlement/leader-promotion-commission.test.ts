import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import {
  buildPromotionCommissionWalkForMember,
  collectLeaderPromotionDemotionMemberIds,
  comparePromotionAccumulationRows,
  explainPromotionAccumulationExclusion,
  isPromotionAccumulationJoinContractRow,
  resolvePromotionUnitSplit,
  type AttributedJoinContractRow,
} from './leader-promotion';

const MEMBER = 'member-1';
const treeRows: OrgTreeRow[] = [
  { id: MEMBER, name: 'M', rank: '리더', parent_id: null, depth: 0 },
];

function row(
  id: string,
  units: number,
  order: {
    happy_call_at: string;
    join_date?: string;
    sequence_no?: number;
    invoice_registered_at?: string;
    created_at?: string;
    status?: string;
    happycall_result?: string;
    invoice_no?: string | null;
  },
): AttributedJoinContractRow {
  return {
    id,
    contract_code: id,
    status: order.status ?? '가입',
    join_date: (order.join_date ?? order.happy_call_at).slice(0, 10),
    unit_count: units,
    sales_member_id: MEMBER,
    sequence_no: order.sequence_no ?? null,
    happy_call_at: order.happy_call_at,
    invoice_registered_at: order.invoice_registered_at ?? null,
    created_at: order.created_at ?? `${order.happy_call_at}T00:00:00Z`,
    happycall_result: order.happycall_result ?? '성공',
    invoice_no: order.invoice_no === undefined ? 'INV-1' : order.invoice_no,
  };
}

function walk(rows: AttributedJoinContractRow[]) {
  return buildPromotionCommissionWalkForMember(MEMBER, treeRows, rows);
}

describe('leader promotion commission (walk SSOT)', () => {
  it('1) 해피콜 완료일 우선 — A(6/19) before B(6/20) despite later join/sequence', () => {
    const a = row('A', 1, {
      happy_call_at: '2026-06-19',
      join_date: '2026-06-21',
      sequence_no: 999,
    });
    const b = row('B', 1, {
      happy_call_at: '2026-06-20',
      join_date: '2026-06-01',
      sequence_no: 1,
    });
    assert.ok(comparePromotionAccumulationRows(a, b) < 0);
    const { audit } = walk([b, a]);
    assert.equal(audit[0]?.contractId, 'A');
    assert.equal(audit[1]?.contractId, 'B');
  });

  it('1b) 동일 해피콜일 → 가입일 → 순번', () => {
    const earlyJoin = row('early-join', 1, {
      happy_call_at: '2026-07-27',
      join_date: '2026-07-23',
      sequence_no: 200,
    });
    const lateJoin = row('late-join', 1, {
      happy_call_at: '2026-07-27',
      join_date: '2026-07-26',
      sequence_no: 50,
    });
    assert.ok(comparePromotionAccumulationRows(earlyJoin, lateJoin) < 0);

    const seqLow = row('seq-low', 1, {
      happy_call_at: '2026-07-27',
      join_date: '2026-07-26',
      sequence_no: 56,
    });
    const seqHigh = row('seq-high', 1, {
      happy_call_at: '2026-07-27',
      join_date: '2026-07-26',
      sequence_no: 201,
    });
    assert.ok(comparePromotionAccumulationRows(seqLow, seqHigh) < 0);
  });

  it('2) 준비/대기 + 해피콜 성공/완료 + 송장 → 가입 인정·누적 포함', () => {
    const waitRow = {
      status: '대기',
      sales_member_id: MEMBER,
      happycall_result: '성공',
      invoice_no: 'INV-OK',
    };
    assert.equal(isPromotionAccumulationJoinContractRow(waitRow), true);
    assert.equal(
      isPromotionAccumulationJoinContractRow({
        status: '대기',
        sales_member_id: MEMBER,
        happycall_result: '완료',
        invoice_no: 'INV-OK',
      }),
      true,
    );
    const r = row('wait-ok', 1, {
      happy_call_at: '2026-06-01',
      status: '대기',
    });
    const { splitByContractId } = walk([r]);
    assert.equal(splitByContractId.get('wait-ok')?.prePromotionUnits, 1);
  });

  it('3) 준비/대기 — 송장 없음 또는 해피콜 성공 아님 → 제외', () => {
    assert.equal(
      explainPromotionAccumulationExclusion({
        status: '준비',
        sales_member_id: MEMBER,
        happycall_result: '성공',
        invoice_no: null,
      }).exclusion_reason,
      'INVOICE_MISSING',
    );
    assert.equal(
      explainPromotionAccumulationExclusion({
        status: '대기',
        sales_member_id: MEMBER,
        happycall_result: '부재',
        invoice_no: 'INV-1',
      }).exclusion_reason,
      'HAPPYCALL_NOT_SUCCESS',
    );
    assert.equal(
      isPromotionAccumulationJoinContractRow({
        status: '대기',
        sales_member_id: MEMBER,
        happycall_result: '성공',
        invoice_no: null,
      }),
      false,
    );
  });

  it('4) 김세영 — 5/22 20구좌 달성, 6월 직접 계약 40만', () => {
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 18 }, (_, i) =>
        row(`past-${i}`, 1, { happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}` }),
      ),
      row('TY053', 1, {
        happy_call_at: '2026-05-22',
        join_date: '2026-05-22',
        sequence_no: 53,
      }),
      row('TY352', 1, {
        happy_call_at: '2026-05-22',
        join_date: '2026-05-22',
        sequence_no: 352,
      }),
      row('TY015', 1, { happy_call_at: '2026-06-10' }),
      row('TY016', 1, { happy_call_at: '2026-06-10', sequence_no: 16 }),
      row('TY281', 1, { happy_call_at: '2026-06-12' }),
      // 산하 walk에만 포함(본인 직접 아님) — 6월 24일 20구좌가 여기로 잡히면 안 됨
      {
        ...row('TY119-sub', 1, { happy_call_at: '2026-06-24' }),
        sales_member_id: 'subordinate-1',
      },
    ];
    const { splitByContractId, audit } = walk(rows);
    const promo = audit.find((a) => a.promotionReason === 'PROMOTION_CONTRACT');
    assert.ok(promo?.contractCode === 'TY352' || promo?.contractCode === 'TY053');
    for (const code of ['TY015', 'TY016', 'TY281']) {
      const a = audit.find((x) => x.contractCode === code);
      assert.equal(a?.commissionPerUnit, 400_000, code);
      assert.equal(a?.promotionReason, 'AFTER_PROMOTION', code);
      assert.equal(splitByContractId.get(code)?.postPromotionUnits, 1, code);
    }
  });

  it('5) 조자양 — 누적 20구좌 미만 → 전량 30만 (이벤트 있어도)', () => {
    const thresholdId = 'jo-threshold';
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 11 }, (_, i) =>
        row(`before-${i}`, 1, { happy_call_at: `2026-06-${String(i + 1).padStart(2, '0')}` }),
      ),
      { ...row(thresholdId, 1, { happy_call_at: '2026-06-25', sequence_no: 1 }), id: thresholdId },
      row('after-1', 1, { happy_call_at: '2026-06-25', sequence_no: 2 }),
      row('after-2', 1, { happy_call_at: '2026-06-25', sequence_no: 3 }),
    ];
    const { splitByContractId, audit } = walk(rows);
    assert.equal(audit.filter((a) => a.commissionPerUnit === 400_000).length, 0);
    for (const a of audit.filter((x) => x.contractCode.startsWith('after') || x.contractCode.startsWith('before'))) {
      assert.equal(a.commissionPerUnit, 300_000);
      assert.equal(a.promotionReason, 'BEFORE_PROMOTION');
    }
    assert.equal(splitByContractId.get('after-1')?.postPromotionUnits, 0);
    assert.equal(splitByContractId.get('after-2')?.postPromotionUnits, 0);
  });

  it('6) 누적 18구좌 + 3구좌 승급 계약 → 전량 30만, 이후 계약부터 40만', () => {
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 18 }, (_, i) => row(`c-${i}`, 1, { happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}` })),
      row('span', 3, { happy_call_at: '2026-06-20' }),
      row('after', 1, { happy_call_at: '2026-06-21' }),
    ];
    const { splitByContractId, audit } = walk(rows);
    assert.equal(splitByContractId.get('span')?.prePromotionUnits, 3);
    assert.equal(splitByContractId.get('span')?.postPromotionUnits, 0);
    assert.equal(audit.find((a) => a.contractId === 'span')?.promotionReason, 'PROMOTION_CONTRACT');
    assert.equal(audit.find((a) => a.contractId === 'span')?.commissionPerUnit, 300_000);
    assert.equal(splitByContractId.get('after')?.prePromotionUnits, 0);
    assert.equal(splitByContractId.get('after')?.postPromotionUnits, 1);
    assert.equal(audit.find((a) => a.contractId === 'after')?.commissionPerUnit, 400_000);
  });

  it('7) walk에 없는 직접매출도 승급 threshold 이후면 40만', () => {
    // 고객노드 재매핑으로 walk 귀속이 다른 멤버로 간 경우(이지현→임태순 등)
    const threshold = {
      threshold_contract_id: 'TY201',
      threshold_join_date: '2026-07-27',
    };
    const emptyWalk = new Map();
    const after = {
      id: 'TY277',
      join_date: '2026-07-24',
      happy_call_at: '2026-07-28T00:00:00Z',
      unit_count: 1,
      created_at: '2026-07-24T12:00:00Z',
      invoice_registered_at: '2026-08-04T01:00:00Z',
    };
    const before = {
      id: 'TY100',
      join_date: '2026-07-20',
      happy_call_at: '2026-07-26T00:00:00Z',
      unit_count: 1,
      created_at: '2026-07-20T12:00:00Z',
    };
    assert.deepEqual(resolvePromotionUnitSplit(after, emptyWalk, threshold), {
      prePromotionUnits: 0,
      postPromotionUnits: 1,
    });
    assert.deepEqual(resolvePromotionUnitSplit(before, emptyWalk, threshold), {
      prePromotionUnits: 1,
      postPromotionUnits: 0,
    });
    // threshold 없으면 기존처럼 전량 30만
    assert.deepEqual(resolvePromotionUnitSplit(after, emptyWalk, null), {
      prePromotionUnits: 1,
      postPromotionUnits: 0,
    });
  });
});

describe('collectLeaderPromotionDemotionMemberIds', () => {
  it('이벤트가 있어도 인정 walk 미달이면 강등 대상', () => {
    const rows: AttributedJoinContractRow[] = [
      row('a', 1, { happy_call_at: '2026-07-01' }),
      row('b', 1, { happy_call_at: '2026-07-02' }),
    ];
    const ids = collectLeaderPromotionDemotionMemberIds({
      treeRows,
      joinAttributed: rows,
      promotionEventMemberIds: new Set([MEMBER]),
      members: [{ id: MEMBER, rank: '리더' }],
    });
    assert.deepEqual(ids, [MEMBER]);
  });

  it('이벤트가 없으면 강등하지 않음', () => {
    const ids = collectLeaderPromotionDemotionMemberIds({
      treeRows,
      joinAttributed: [],
      promotionEventMemberIds: new Set(),
      members: [{ id: MEMBER, rank: '리더' }],
    });
    assert.deepEqual(ids, []);
  });
});
