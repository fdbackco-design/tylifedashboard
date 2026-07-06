/**
 * 승급 이벤트 감사 (DB 연동).
 *
 * 실행:
 *   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... \
 *     npx vitest run src/lib/settlement/promotion-event-audit.integration.test.ts
 *
 * 기본 멤버: 김세영 3940bcfe-4971-4298-b55c-06cc6da15c9c
 * 다른 멤버: AUDIT_MEMBER_ID=<uuid> 환경변수
 */
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  formatPromotionEventAuditReport,
  isPromotionAccumulationJoinContractRow,
  validatePromotionEvent,
  type AttributedJoinContractRow,
  type JoinStatusContractCandidate,
  type LeaderPromotionEventRecord,
  type SalesMemberPromotionThreshold,
} from './leader-promotion';
import { happycallYmdSeoul } from './settlement-eligibility-v2';
import type { RankType } from '@/lib/types/organization';

const DEFAULT_MEMBER_ID = '3940bcfe-4971-4298-b55c-06cc6da15c9c';
const hasDb =
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

describe.skipIf(!hasDb)('promotion event audit (integration)', () => {
  it('김세영 승급 이벤트·walk·누락 계약 감사 출력', async () => {
    const memberId = process.env.AUDIT_MEMBER_ID ?? DEFAULT_MEMBER_ID;
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const [{ data: promoEvent }, { data: member }, membersRes, edgesRes, { data: contracts }] =
      await Promise.all([
        db
          .from('leader_promotion_events')
          .select('*')
          .eq('member_id', memberId)
          .maybeSingle(),
        db.from('organization_members').select('id, name, rank').eq('id', memberId).maybeSingle(),
        db
          .from('organization_members')
          .select('id, name, rank, source_customer_id')
          .eq('is_active', true),
        db.from('organization_edges').select('parent_id, child_id'),
        db
          .from('contracts')
          .select(
            'id, contract_code, status, join_date, unit_count, sales_member_id, is_cancelled, sales_link_status, happy_call_at, happycall_result, invoice_no, invoice_registered_at, created_at, product_type, item_name, source_snapshot_json',
          ),
      ]);

    if (!promoEvent) {
      // eslint-disable-next-line no-console
      console.warn(`leader_promotion_events 없음: member_id=${memberId}`);
      return;
    }
    if (!member) {
      // eslint-disable-next-line no-console
      console.warn(`organization_members 없음: member_id=${memberId}`);
      return;
    }

    const treeRows = buildSettlementTreeRows(
      (membersRes.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        rank: m.rank as RankType,
        source_customer_id: m.source_customer_id ?? null,
      })),
      (edgesRes.data ?? []) as Array<{ parent_id: string | null; child_id: string }>,
    );

    const joinAttributed: AttributedJoinContractRow[] = [];
    const joinStatusCandidates: JoinStatusContractCandidate[] = [];
    for (const row of contracts ?? []) {
      if (String(row.status ?? '').trim() !== '가입') continue;
      if (!row.sales_member_id) continue;
      const base = {
        id: row.id,
        contract_code: row.contract_code ?? null,
        unit_count: row.unit_count ?? 0,
        sales_member_id: row.sales_member_id as string,
        join_date: String(row.join_date ?? '').slice(0, 10),
        status: String(row.status ?? ''),
        is_cancelled: row.is_cancelled ?? null,
        sales_link_status: (row.sales_link_status ?? null) as string | null,
        happy_call_at: row.happy_call_at ?? null,
        happycall_result: (row.happycall_result ?? null) as string | null,
        invoice_no: (row.invoice_no ?? null) as string | null,
        invoice_registered_at: (row.invoice_registered_at ?? null) as string | null,
        created_at: (row.created_at ?? null) as string | null,
        product_type: (row.product_type ?? null) as string | null,
        item_name: (row.item_name ?? null) as string | null,
        source_snapshot_json: (row.source_snapshot_json ?? null) as Record<string, string | null> | null,
      };
      joinStatusCandidates.push(base);
      if (!isPromotionAccumulationJoinContractRow(row)) continue;
      const hcYmd = happycallYmdSeoul(row.happy_call_at);
      joinAttributed.push({
        ...base,
        happy_call_at: hcYmd || (row.happy_call_at ?? null),
      });
    }

    const threshold: SalesMemberPromotionThreshold = {
      threshold_contract_id: String(promoEvent!.threshold_contract_id),
      threshold_join_date: String(promoEvent!.threshold_join_date).slice(0, 10),
    };
    const event: LeaderPromotionEventRecord = {
      member_id: memberId,
      threshold_contract_id: threshold.threshold_contract_id,
      threshold_join_date: threshold.threshold_join_date,
      previous_parent_id: (promoEvent!.previous_parent_id ?? null) as string | null,
      created_at: (promoEvent!.created_at ?? null) as string | null,
    };

    const validation = validatePromotionEvent({
      memberId,
      treeRows,
      joinAttributed,
      joinStatusCandidates,
      event,
      threshold,
    });

    const report = formatPromotionEventAuditReport(validation);
    // eslint-disable-next-line no-console
    console.log('\n' + report);
    // eslint-disable-next-line no-console
    console.log('\n멤버:', member?.name, memberId);

    expect(validation.threshold_contract_id).toBeTruthy();
  });
});
