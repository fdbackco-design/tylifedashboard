/**
 * POST /api/admin/contracts/settlement-sales-member/preview
 *
 * 현재 조직도 구조 기준 담당자 vs 현재 effective 담당자(settlement_sales_member_id ?? sales_member_id) 가
 * 다른 계약을 찾아 미리보기 목록을 반환한다. (DB 는 절대 수정하지 않는다.)
 *
 * 응답
 *   {
 *     diffs: Array<{
 *       contract_id, contract_code, customer_name, unit_count, status,
 *       ty_sales_member_id, ty_sales_member_name,
 *       current_settlement_sales_member_id, current_settlement_sales_member_name,
 *       org_based_sales_member_id, org_based_sales_member_name,
 *       proposed_settlement_sales_member_id,
 *       eligible_for_auto_apply,        // 자동 보정 가능한지
 *       skip_reason,                    // 자동 보정 불가 시 사유
 *       decision,                       // 매핑 근거
 *     }>,
 *     summary: { total_scanned, total_diff, auto_eligible, skipped_by_reason }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import {
  buildOrgAttributionContext,
  type AttributionContractInput,
  type AttributionMemberInput,
} from '@/lib/organization/org-attribution';

const CANCEL_HAPPYCALL: ReadonlySet<string> = new Set([
  '해약',
  '계약취소',
  '취소',
  '기타',
  '부재',
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = createAdminSupabaseClient();

  const [membersRes, contractsRes] = await Promise.all([
    db
      .from('organization_members')
      .select('id, name, rank, phone, external_id, source_customer_id, is_active'),
    db
      .from('contracts')
      .select(
        [
          'id',
          'contract_code',
          'sales_member_id',
          'settlement_sales_member_id',
          'customer_id',
          'status',
          'unit_count',
          'rental_request_no',
          'invoice_no',
          'memo',
          'is_cancelled',
          'happycall_result',
          'sales_link_status',
          'customers(name, phone)',
        ].join(', '),
      ),
  ]);

  if (membersRes.error) {
    return NextResponse.json({ error: membersRes.error.message }, { status: 500 });
  }
  if (contractsRes.error) {
    return NextResponse.json({ error: contractsRes.error.message }, { status: 500 });
  }

  const members: AttributionMemberInput[] = ((membersRes.data ?? []) as any[]).map((m) => ({
    id: m.id,
    name: m.name ?? null,
    rank: m.rank ?? null,
    phone: m.phone ?? null,
    external_id: m.external_id ?? null,
    source_customer_id: m.source_customer_id ?? null,
  }));

  const ctx = buildOrgAttributionContext(members);

  // 추가로 비활성/존재하지 않는 member 도 한 번 더 거를 수 있도록 active set
  const activeMemberIds = new Set(
    ((membersRes.data ?? []) as any[])
      .filter((m) => m.is_active !== false)
      .map((m) => m.id as string),
  );

  type DiffRow = {
    contract_id: string;
    contract_code: string | null;
    customer_name: string | null;
    unit_count: number | null;
    status: string | null;
    ty_sales_member_id: string | null;
    ty_sales_member_name: string | null;
    current_settlement_sales_member_id: string | null;
    current_settlement_sales_member_name: string | null;
    org_based_sales_member_id: string | null;
    org_based_sales_member_name: string | null;
    proposed_settlement_sales_member_id: string | null;
    eligible_for_auto_apply: boolean;
    skip_reason: string | null;
    decision: string;
  };

  const diffs: DiffRow[] = [];
  const skippedByReason: Record<string, number> = {};
  const bump = (k: string) => {
    skippedByReason[k] = (skippedByReason[k] ?? 0) + 1;
  };

  const rows = (contractsRes.data ?? []) as any[];

  for (const r of rows) {
    const c: AttributionContractInput = {
      id: r.id,
      contract_code: r.contract_code ?? null,
      sales_member_id: r.sales_member_id ?? null,
      customer_id: r.customer_id ?? null,
      status: r.status ?? null,
      rental_request_no: r.rental_request_no ?? null,
      invoice_no: r.invoice_no ?? null,
      memo: r.memo ?? null,
      customer_phone: r.customers?.phone ?? null,
      customer_name: r.customers?.name ?? null,
    };

    const result = ctx.resolveOrgBasedSalesMember(c);
    // 현재 effective 담당자 (정산 로직과 동일 우선순위)
    const currentSettlement = (r.settlement_sales_member_id ?? null) as string | null;
    const tyOriginal = (r.sales_member_id ?? null) as string | null;
    const effectiveCurrent = currentSettlement ?? tyOriginal;

    // page.tsx 의 contractsByMember 키와 동일하게: remapMemberId 적용
    const orgBasedMapped = ctx.remapMemberId(result.org_based_sales_member_id);
    const effectiveCurrentMapped = ctx.remapMemberId(effectiveCurrent);

    if (!orgBasedMapped) {
      // 조직도 기준 담당자 확정 불가 → diff 가 아니라 "비교 자체 불가" 이므로 미리보기에 포함 X
      continue;
    }

    if (effectiveCurrentMapped === orgBasedMapped) {
      // 이미 일치
      continue;
    }

    // diff 발견 → 자동 보정 가능 여부 평가
    let skip: string | null = null;

    // (a) 취소/해약 계약 제외
    if (r.is_cancelled === true) skip = '취소/해약 계약';
    if (!skip) {
      const hc = (r.happycall_result ?? '').toString().trim();
      if (hc && CANCEL_HAPPYCALL.has(hc)) skip = '해피콜 결과가 취소/해약';
    }

    // (b) 모호한 후보(여러 명) — page.tsx 의 결정은 첫 번째지만, 자동 보정은 보수적으로 제외
    if (!skip && result.decision === 'ambiguous') {
      skip = '담당자 후보가 여러 명으로 모호';
    }

    // (c) 조직도 기준 담당자가 비활성/존재하지 않으면 제외
    if (!skip && !activeMemberIds.has(orgBasedMapped)) {
      skip = '조직도 기준 담당자가 비활성/존재하지 않음';
    }

    // (d) sales_link_status 가 linked 가 아닌 계약은 page.tsx 가 정책 승격 계산에서 제외하므로 보수적으로 제외
    if (!skip && (r.sales_link_status ?? 'linked') !== 'linked') {
      skip = '계약-담당자 매칭 실패 (sales_link_status != linked)';
    }

    // (e) 조직도 기준 담당자 = TY 담당자 (즉 변경 후 = 변경 전인데 effective 만 다른 경우)
    //     이건 사실상 override 해제와 동치이므로 자동 적용 후보로는 둔다.
    //     단, decision='sales_member_id' 인데 mapped 가 effective 와 같다면 위에서 이미 continue.

    if (skip) bump(skip);

    diffs.push({
      contract_id: r.id,
      contract_code: r.contract_code ?? null,
      customer_name: r.customers?.name ?? null,
      unit_count: r.unit_count ?? null,
      status: r.status ?? null,
      ty_sales_member_id: tyOriginal,
      ty_sales_member_name: tyOriginal ? ctx.memberNameById.get(tyOriginal) ?? null : null,
      current_settlement_sales_member_id: currentSettlement,
      current_settlement_sales_member_name: currentSettlement
        ? ctx.memberNameById.get(currentSettlement) ?? null
        : null,
      org_based_sales_member_id: orgBasedMapped,
      org_based_sales_member_name: ctx.memberNameById.get(orgBasedMapped) ?? null,
      proposed_settlement_sales_member_id: orgBasedMapped,
      eligible_for_auto_apply: skip === null,
      skip_reason: skip,
      decision: result.decision,
    });
  }

  // 보기 좋게: 적용 가능 → 적용 불가 순으로 정렬, 그 안에서 계약코드 오름차순
  diffs.sort((a, b) => {
    if (a.eligible_for_auto_apply !== b.eligible_for_auto_apply) {
      return a.eligible_for_auto_apply ? -1 : 1;
    }
    return (a.contract_code ?? '').localeCompare(b.contract_code ?? '');
  });

  return NextResponse.json({
    diffs,
    summary: {
      total_scanned: rows.length,
      total_diff: diffs.length,
      auto_eligible: diffs.filter((d) => d.eligible_for_auto_apply).length,
      skipped_by_reason: skippedByReason,
    },
  });
}
