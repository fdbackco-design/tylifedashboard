import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import {
  buildPromotionCommissionWalkForMember,
  buildPromotionUnitSplitByContractId,
  validatePromotionEvent,
  thresholdCrossesPromotionBoundaryInWalk,
  isPromotionAccumulationJoinContractRow,
  resolvePromotionUnitSplit,
  type AttributedJoinContractRow,
  type JoinStatusContractCandidate,
  type SalesMemberPromotionThreshold,
  type LeaderPromotionEventRecord,
} from './leader-promotion';

const MEMBER = 'member-1';
const treeRows: OrgTreeRow[] = [
  { id: MEMBER, name: 'M', rank: '리더', parent_id: null, depth: 0 },
];

function row(
  id: string,
  units: number,
  order: {
    happy_call_at?: string;
    invoice_registered_at?: string;
    created_at?: string;
  },
): AttributedJoinContractRow {
  return {
    id,
    contract_code: id,
    status: '가입',
    join_date: '2026-06-01',
    unit_count: units,
    sales_member_id: MEMBER,
    happy_call_at: order.happy_call_at ?? '2026-06-01',
    invoice_registered_at: order.invoice_registered_at ?? null,
    created_at: order.created_at ?? `2026-06-01T00:00:00.${id.slice(-3)}Z`,
    happycall_result: '성공',
    invoice_no: 'INV-1',
  };
}

function candidate(
  id: string,
  units: number,
  order: {
    happy_call_at?: string;
    join_date?: string;
    invoice_registered_at?: string;
    created_at?: string;
  },
  opts?: { v2Eligible?: boolean },
): JoinStatusContractCandidate {
  const v2 = opts?.v2Eligible !== false;
  return {
    id,
    contract_code: id,
    unit_count: units,
    sales_member_id: MEMBER,
    join_date: order.join_date ?? '2026-06-01',
    status: '가입',
    happy_call_at: order.happy_call_at ?? '2026-06-01',
    invoice_registered_at: order.invoice_registered_at ?? null,
    created_at: order.created_at ?? `2026-06-01T00:00:00.${id.slice(-3)}Z`,
    happycall_result: v2 ? '성공' : '부재',
    invoice_no: v2 ? 'INV-1' : null,
  };
}

function walk(
  rows: AttributedJoinContractRow[],
  options?: Parameters<typeof buildPromotionCommissionWalkForMember>[4],
) {
  return buildPromotionCommissionWalkForMember(MEMBER, treeRows, rows, 20, options);
}

function eventRecord(
  thresholdId: string,
  thresholdDate: string,
  createdAt?: string,
): LeaderPromotionEventRecord {
  return {
    member_id: MEMBER,
    threshold_contract_id: thresholdId,
    threshold_join_date: thresholdDate,
    created_at: createdAt ?? null,
  };
}

describe('leader promotion commission (cumulative walk SSOT)', () => {
  it('1) 누적 19구좌 + 다음 계약 1구좌 → 30만, 다음부터 40만', () => {
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 19 }, (_, i) => row(`c-${i}`, 1, { happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}` })),
      row('promo', 1, { happy_call_at: '2026-06-20' }),
      row('after', 1, { happy_call_at: '2026-06-21' }),
    ];
    const { splitByContractId, audit } = walk(rows);
    assert.equal(splitByContractId.get('promo')?.prePromotionUnits, 1);
    assert.equal(splitByContractId.get('promo')?.postPromotionUnits, 0);
    assert.equal(splitByContractId.get('after')?.postPromotionUnits, 1);
    const promoAudit = audit.find((a) => a.contractId === 'promo');
    assert.equal(promoAudit?.promotionReason, 'PROMOTION_CONTRACT');
    assert.equal(audit.find((a) => a.contractId === 'after')?.promotionReason, 'AFTER_PROMOTION');
  });

  it('2) 누적 18구좌 + 다음 계약 2구좌 → 전량 30만, 다음부터 40만', () => {
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 18 }, (_, i) => row(`c-${i}`, 1, { happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}` })),
      row('promo', 2, { happy_call_at: '2026-06-20' }),
      row('after', 1, { happy_call_at: '2026-06-21' }),
    ];
    const { splitByContractId } = walk(rows);
    assert.equal(splitByContractId.get('promo')?.prePromotionUnits, 2);
    assert.equal(splitByContractId.get('promo')?.postPromotionUnits, 0);
    assert.equal(splitByContractId.get('after')?.postPromotionUnits, 1);
  });

  it('3) 누적 18구좌 + 다음 계약 3구좌 → 20까지 30만, 21구좌부터 40만', () => {
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 18 }, (_, i) => row(`c-${i}`, 1, { happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}` })),
      row('span', 3, { happy_call_at: '2026-06-20' }),
      row('after', 1, { happy_call_at: '2026-06-21' }),
    ];
    const { splitByContractId } = walk(rows);
    assert.equal(splitByContractId.get('span')?.prePromotionUnits, 2);
    assert.equal(splitByContractId.get('span')?.postPromotionUnits, 1);
    assert.equal(splitByContractId.get('after')?.postPromotionUnits, 1);
  });

  it('4) 현재 리더지만 과거 가입 누적 20구좌 이전 → 과거 계약 30만', () => {
    const rows: AttributedJoinContractRow[] = [
      row('a', 1, { happy_call_at: '2026-06-01' }),
      row('b', 1, { happy_call_at: '2026-06-02' }),
    ];
    const split = buildPromotionUnitSplitByContractId(MEMBER, treeRows, rows);
    assert.equal(split.get('a')?.postPromotionUnits, 0);
    assert.equal(split.get('b')?.postPromotionUnits, 0);
  });

  it('5) 가입이 아닌 계약은 누적 제외 → walk에 없으면 30만', () => {
    const joinRows = [row('join-1', 1, { happy_call_at: '2026-06-01' })];
    const splitMap = buildPromotionUnitSplitByContractId(MEMBER, treeRows, joinRows);
    const nonJoin = resolvePromotionUnitSplit(
      { id: 'wait-1', join_date: '2026-06-02', unit_count: 1 },
      splitMap,
    );
    assert.equal(nonJoin.prePromotionUnits, 1);
    assert.equal(nonJoin.postPromotionUnits, 0);
    assert.equal(
      isPromotionAccumulationJoinContractRow({ status: '대기', sales_member_id: MEMBER, happycall_result: '성공', invoice_no: 'X' }),
      false,
    );
  });

  it('6) 동일 해피콜일 → invoice(초) → created_at → id 정렬', () => {
    const rows: AttributedJoinContractRow[] = [
      row('b', 1, {
        happy_call_at: '2026-06-25',
        invoice_registered_at: '2026-06-25T10:00:01.000Z',
        created_at: '2026-06-25T09:00:02Z',
      }),
      row('a', 1, {
        happy_call_at: '2026-06-25',
        invoice_registered_at: '2026-06-25T10:00:01.000Z',
        created_at: '2026-06-25T09:00:01Z',
      }),
    ];
    const { audit } = walk(rows);
    assert.equal(audit[0]?.contractId, 'a');
    assert.equal(audit[1]?.contractId, 'b');
  });

  it('7) 과거 가입 합산 20구좌 초과 시 정산월 계약 40만', () => {
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 20 }, (_, i) => row(`past-${i}`, 1, { happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}` })),
      row('june', 1, { happy_call_at: '2026-06-25' }),
    ];
    const { splitByContractId } = walk(rows);
    assert.equal(splitByContractId.get('june')?.postPromotionUnits, 1);
    assert.equal(splitByContractId.get('june')?.prePromotionUnits, 0);
  });

  it('8) 조자양 — threshold walk 포함·누적 18구좌 → EARLY_OR_INVALID·전량 30만', () => {
    const thresholdId = 'ty021-threshold';
    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: thresholdId,
      threshold_join_date: '2026-06-25',
    };
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 11 }, (_, i) =>
        row(`before-${i}`, 1, { happy_call_at: `2026-06-${String(i + 1).padStart(2, '0')}` }),
      ),
      { ...row(thresholdId, 1, { happy_call_at: '2026-06-25' }), id: thresholdId },
      row('after-1', 1, { happy_call_at: '2026-06-25', invoice_registered_at: '2026-06-25T12:00:01.000Z' }),
      row('after-2', 1, { happy_call_at: '2026-06-25', invoice_registered_at: '2026-06-25T12:00:02.000Z' }),
    ];
    const candidates = rows.map((r) =>
      candidate(r.id, r.unit_count, { happy_call_at: r.happy_call_at ?? undefined }),
    );
    const validation = validatePromotionEvent({
      memberId: MEMBER,
      treeRows,
      joinAttributed: rows,
      joinStatusCandidates: candidates,
      event: eventRecord(thresholdId, '2026-06-25', '2026-07-01T00:00:00Z'),
      threshold,
    });
    assert.equal(validation.status, 'EARLY_OR_INVALID');
    assert.equal(validation.commission_strategy, 'WALK_SSOT');
    const { splitByContractId, audit } = walk(rows, {
      promotionThresholdByMemberId: new Map([[MEMBER, threshold]]),
      promotionEventsByMemberId: new Map([[MEMBER, eventRecord(thresholdId, '2026-06-25', '2026-07-01T00:00:00Z')]]),
      joinStatusCandidates: candidates,
      treeRows,
    });
    assert.equal(splitByContractId.get('after-1')?.postPromotionUnits, 0);
    assert.equal(audit.find((a) => a.contractId === 'after-1')?.promotionReason, 'BEFORE_PROMOTION');
  });

  it('9) 김세영 — legacy walk로 20구좌 검증 → LEGACY_VERIFIED·이후 40만', () => {
    const thresholdId = 'may-threshold-legacy';
    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: thresholdId,
      threshold_join_date: '2026-05-21',
    };
    const pastLegacy = Array.from({ length: 19 }, (_, i) =>
      candidate(`past-${i}`, 1, {
        happy_call_at: `2026-05-${String(i + 1).padStart(2, '0')}`,
        join_date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      }, { v2Eligible: false }),
    );
    const thresholdCandidate = candidate(thresholdId, 1, {
      happy_call_at: '2026-05-21',
      join_date: '2026-05-21',
    }, { v2Eligible: false });
    const juneRows: AttributedJoinContractRow[] = Array.from({ length: 4 }, (_, i) =>
      row(`june-${i}`, 1, { happy_call_at: `2026-06-${String(10 + i)}` }),
    );
    const juneCandidates = juneRows.map((r) =>
      candidate(r.id, r.unit_count, { happy_call_at: r.happy_call_at ?? undefined }),
    );
    const joinStatusCandidates = [...pastLegacy, thresholdCandidate, ...juneCandidates];

    const validation = validatePromotionEvent({
      memberId: MEMBER,
      treeRows,
      joinAttributed: juneRows,
      joinStatusCandidates,
      event: eventRecord(thresholdId, '2026-05-21', '2026-06-11T00:00:00Z'),
      threshold,
    });
    assert.equal(validation.status, 'LEGACY_VERIFIED');
    assert.equal(validation.commission_strategy, 'EVENT_THRESHOLD');
    assert.ok(validation.excluded_from_canonical_walk.length >= 19);
    assert.equal(validation.legacy_cumulative_units_at_threshold, 19);

    const { splitByContractId, audit } = walk(juneRows, {
      promotionThresholdByMemberId: new Map([[MEMBER, threshold]]),
      promotionEventsByMemberId: new Map([[MEMBER, eventRecord(thresholdId, '2026-05-21')]]),
      joinStatusCandidates,
      treeRows,
    });
    assert.equal(splitByContractId.get('june-0')?.postPromotionUnits, 1);
    assert.equal(audit.find((a) => a.contractId === 'june-0')?.promotionReason, 'AFTER_PROMOTION');
  });

  it('10) 이벤트 날짜만 과거·20구좌 근거 없음 → MISSING_HISTORY·날짜로 40만 금지', () => {
    const thresholdId = 'ghost-threshold';
    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: thresholdId,
      threshold_join_date: '2026-05-21',
    };
    const rows: AttributedJoinContractRow[] = [
      row('june-a', 1, { happy_call_at: '2026-06-10' }),
      row('june-b', 1, { happy_call_at: '2026-06-11' }),
    ];
    const candidates = rows.map((r) =>
      candidate(r.id, r.unit_count, { happy_call_at: r.happy_call_at ?? undefined }),
    );
    const validation = validatePromotionEvent({
      memberId: MEMBER,
      treeRows,
      joinAttributed: rows,
      joinStatusCandidates: candidates,
      event: eventRecord(thresholdId, '2026-05-21', '2026-05-21T00:00:00Z'),
      threshold,
    });
    assert.equal(validation.status, 'MISSING_HISTORY');
    assert.equal(validation.commission_strategy, 'REVIEW_PENDING');
    assert.equal(validation.requires_review, true);

    const { splitByContractId } = walk(rows, {
      promotionThresholdByMemberId: new Map([[MEMBER, threshold]]),
      promotionEventsByMemberId: new Map([[MEMBER, eventRecord(thresholdId, '2026-05-21')]]),
      joinStatusCandidates: candidates,
      treeRows,
    });
    assert.equal(splitByContractId.get('june-a')?.postPromotionUnits, 0);
    assert.equal(splitByContractId.get('june-b')?.postPromotionUnits, 0);
  });

  it('11) 동일 날짜 이벤트·계약 — 날짜 비교가 수당에 영향 없음 (조자양)', () => {
    const thresholdId = 'same-day-threshold';
    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: thresholdId,
      threshold_join_date: '2026-06-25',
    };
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 11 }, (_, i) =>
        row(`before-${i}`, 1, { happy_call_at: `2026-06-${String(i + 1).padStart(2, '0')}` }),
      ),
      { ...row(thresholdId, 1, { happy_call_at: '2026-06-25' }), id: thresholdId },
      row('after', 1, { happy_call_at: '2026-06-25', invoice_registered_at: '2026-06-25T12:00:01.000Z' }),
    ];
    const candidates = rows.map((r) =>
      candidate(r.id, r.unit_count, {
        happy_call_at: r.happy_call_at ?? undefined,
        join_date: '2026-06-25',
      }),
    );
    const validationSameDay = validatePromotionEvent({
      memberId: MEMBER,
      treeRows,
      joinAttributed: rows,
      joinStatusCandidates: candidates,
      event: eventRecord(thresholdId, '2026-06-25', '2026-06-25T00:00:00Z'),
      threshold,
    });
    const validationLateEvent = validatePromotionEvent({
      memberId: MEMBER,
      treeRows,
      joinAttributed: rows,
      joinStatusCandidates: candidates,
      event: eventRecord(thresholdId, '2026-06-25', '2026-07-01T00:00:00Z'),
      threshold,
    });
    assert.equal(validationSameDay.status, validationLateEvent.status);
    assert.equal(validationSameDay.commission_strategy, validationLateEvent.commission_strategy);
    assert.equal(validationSameDay.status, 'EARLY_OR_INVALID');
  });

  it('12) threshold walk 포함 + walk≥20 — VERIFIED_BY_WALK', () => {
    const thresholdId = 'wrong-early-threshold';
    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: thresholdId,
      threshold_join_date: '2026-06-05',
    };
    const rows: AttributedJoinContractRow[] = [
      ...Array.from({ length: 4 }, (_, i) =>
        row(`before-${i}`, 1, { happy_call_at: `2026-06-${String(i + 1).padStart(2, '0')}` }),
      ),
      { ...row(thresholdId, 1, { happy_call_at: '2026-06-05' }), id: thresholdId },
      ...Array.from({ length: 15 }, (_, i) =>
        row(`mid-${i}`, 1, { happy_call_at: `2026-06-${String(i + 10).padStart(2, '0')}` }),
      ),
      row('after-21', 1, { happy_call_at: '2026-06-25' }),
    ];
    const validation = validatePromotionEvent({
      memberId: MEMBER,
      treeRows,
      joinAttributed: rows,
      joinStatusCandidates: rows.map((r) => candidate(r.id, r.unit_count, { happy_call_at: r.happy_call_at ?? undefined })),
      event: eventRecord(thresholdId, '2026-06-05'),
      threshold,
    });
    assert.equal(validation.status, 'VERIFIED_BY_WALK');
    assert.equal(thresholdCrossesPromotionBoundaryInWalk(MEMBER, treeRows, rows, thresholdId), false);
    const { splitByContractId } = walk(rows, {
      promotionThresholdByMemberId: new Map([[MEMBER, threshold]]),
      promotionEventsByMemberId: new Map([[MEMBER, eventRecord(thresholdId, '2026-06-05')]]),
      treeRows,
    });
    assert.equal(splitByContractId.get('after-21')?.postPromotionUnits, 1);
  });
});
