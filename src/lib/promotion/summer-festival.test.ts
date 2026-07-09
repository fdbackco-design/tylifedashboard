import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  buildSummerFestivalContractAuditRow,
  evaluateSummerFestivalEligibility,
  summerFestivalPerUnitValue,
  summerFestivalPeriodMultiplier,
  summerFestivalStatus,
} from './summer-festival';

function contract(params: Partial<Parameters<typeof buildSummerFestivalContractAuditRow>[0]> & { id: string }) {
  return {
    id: params.id,
    contract_code: params.contract_code ?? params.id,
    sales_member_id: params.sales_member_id ?? 'sales-1',
    sales_member_name: params.sales_member_name ?? '조명희',
    customer_id: params.customer_id ?? 'cust-1',
    customer_name: params.customer_name ?? '박성현',
    unit_count: params.unit_count ?? 2,
    status: params.status ?? '가입',
    is_cancelled: params.is_cancelled ?? false,
    sales_link_status: params.sales_link_status ?? 'linked',
    happy_call_at: params.happy_call_at ?? '2026-07-10T12:00:00+09:00',
    happycall_result: params.happycall_result ?? '성공',
    invoice_no: params.invoice_no ?? 'INV-1',
    product_type: params.product_type ?? '스페셜라이프케어',
    item_name: params.item_name ?? null,
    source_snapshot_json: params.source_snapshot_json ?? null,
  };
}

describe('summer festival eligibility basics', () => {
  it('해피콜 결과가 성공/완료가 아니면(가입 포함) 제외', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', status: '가입', happycall_result: '실패' }),
    );
    assert.equal(r.eligible, false);
    assert.equal(r.exclusion_reason, 'HAPPYCALL_NOT_SUCCESS');
  });

  it('취소/해약/무효 계약은 제외', () => {
    for (const st of ['취소', '해약', '계약취소', '무효'] as const) {
      const r = buildSummerFestivalContractAuditRow(contract({ id: `c-${st}`, status: st }));
      assert.equal(r.eligible, false);
      assert.equal(r.exclusion_reason, 'STATUS_NOT_ELIGIBLE');
    }
  });

  it('해피콜 완료일이 6/25이면 제외', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', happy_call_at: '2026-06-25T23:59:59+09:00' }),
    );
    assert.equal(r.eligible, false);
    assert.equal(r.exclusion_reason, 'OUTSIDE_WINDOW');
  });

  it('해피콜 완료일이 8/26이면 제외', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', happy_call_at: '2026-08-26T00:00:00+09:00' }),
    );
    assert.equal(r.eligible, false);
    assert.equal(r.exclusion_reason, 'OUTSIDE_WINDOW');
  });

  it('해피콜 미완료/실패(준비/대기)면 제외', () => {
    const dec = evaluateSummerFestivalEligibility({
      sales_member_id: 'sales-1',
      is_cancelled: false,
      sales_link_status: 'linked',
      status: '대기',
      happy_call_at: '2026-07-10T12:00:00+09:00',
      happycall_result: '실패',
      invoice_no: 'INV-1',
    });
    assert.equal(dec.eligible, false);
    assert.equal(dec.exclusion_reason, 'HAPPYCALL_NOT_SUCCESS');
  });
});

describe('direct sale attribution separation', () => {
  it('조명희 담당자, 박성현 고객, 2구좌 → 조명희에게만 인정', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', sales_member_name: '조명희', customer_name: '박성현', unit_count: 2 }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.summer_units, 2);
  });

  it('조명희 고객, 박성현 담당자, 2구좌 → 박성현에게만 인정(조명희 0)', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', sales_member_name: '박성현', customer_name: '조명희', unit_count: 2 }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.summer_units, 2);
  });

  it('자가판매(담당자=가입자), 2구좌 → 본인에게만 인정', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', sales_member_name: '조명희', customer_name: '조명희', unit_count: 2 }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.summer_units, 2);
  });
});

describe('product weights and period multipliers', () => {
  it('기간 배수(경계 포함): 6/26~7/25 ×2, 7/26~8/25 ×1', () => {
    assert.equal(summerFestivalPeriodMultiplier('2026-06-26T00:00:00+09:00'), 2);
    assert.equal(summerFestivalPeriodMultiplier('2026-07-25T23:59:59+09:00'), 2);
    assert.equal(summerFestivalPeriodMultiplier('2026-07-26T00:00:00+09:00'), 1);
    assert.equal(summerFestivalPeriodMultiplier('2026-08-25T23:59:59+09:00'), 1);
    assert.equal(summerFestivalPeriodMultiplier('2026-07-10T12:00:00+09:00'), 2);
    assert.equal(summerFestivalPeriodMultiplier('2026-08-05T12:00:00+09:00'), 1);
  });

  it('갤럭시케어 10구좌 (7/10 ×2) → 썸머 인정 10 (상한 1.0)', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', unit_count: 10, product_type: 'TY갤럭시케어', happy_call_at: '2026-07-10T12:00:00+09:00' }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.per_unit_value, 1.0);
    assert.equal(r.summer_units, 10);
  });

  it('갤럭시케어 10구좌 (8/05 ×1) → 썸머 인정 10', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', unit_count: 10, product_type: 'TY갤럭시케어', happy_call_at: '2026-08-05T12:00:00+09:00' }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.per_unit_value, 1.0);
    assert.equal(r.summer_units, 10);
  });

  it('스페셜라이프케어 10구좌 (7/10 ×2) → min(1, 0.5×2)=1.0 → 10', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', unit_count: 10, product_type: '스페셜라이프케어', happy_call_at: '2026-07-10T12:00:00+09:00' }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.base_weight, 0.5);
    assert.equal(r.period_multiplier, 2);
    assert.equal(r.per_unit_value, 1.0);
    assert.equal(r.summer_units, 10);
  });

  it('스페셜라이프케어 10구좌 (8/05 ×1) → min(1, 0.5×1)=0.5 → 5', () => {
    const r = buildSummerFestivalContractAuditRow(
      contract({ id: 'c1', unit_count: 10, product_type: '스페셜라이프케어', happy_call_at: '2026-08-05T12:00:00+09:00' }),
    );
    assert.equal(r.eligible, true);
    assert.equal(r.base_weight, 0.5);
    assert.equal(r.period_multiplier, 1);
    assert.equal(r.per_unit_value, 0.5);
    assert.equal(r.summer_units, 5);
  });

  it('per-unit 상한은 1.0', () => {
    assert.equal(summerFestivalPerUnitValue({ baseWeight: 1.0, periodMultiplier: 2 }), 1.0);
  });
});

describe('status judgement', () => {
  it('승급 인정 20이지만 실제 갤럭시케어 10구좌 → 썸머 10, 참가 미확정(근접)', () => {
    assert.equal(summerFestivalStatus(10), '근접 대상');
  });

  it('직접판매 썸머 인정 합계 19.5 → 근접 대상', () => {
    assert.equal(summerFestivalStatus(19.5), '근접 대상');
  });

  it('직접판매 썸머 인정 합계 20 → 참가 확정', () => {
    assert.equal(summerFestivalStatus(20), '참가 확정');
  });
});

