import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { OrgTreeRow } from '@/lib/types';
import {
  buildPromotionCommissionWalkForMember,
  buildPromotionUnitSplitByContractId,
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

function walk(rows: AttributedJoinContractRow[]) {
  return buildPromotionCommissionWalkForMember(MEMBER, treeRows, rows);
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
});
