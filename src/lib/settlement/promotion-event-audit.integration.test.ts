/**
 * 승급 walk 감사 (DB 연동).
 *
 *   npm run audit:promotion-event
 *
 * 기본: 김세영 + 조자양
 *   AUDIT_MEMBER_IDS=uuid1,uuid2 npm run audit:promotion-event
 */
import { describe, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { buildSettlementTreeRows } from '@/lib/settlement/settlement-org-tree';
import {
  auditPromotionWalkExclusionsForMember,
  buildPromotionCommissionWalkForMember,
  formatPromotionEventAuditReport,
  formatPromotionWalkCommissionReport,
  isPromotionAccumulationJoinContractRow,
  validatePromotionEvent,
  type AttributedJoinContractRow,
  type JoinStatusContractCandidate,
  type LeaderPromotionEventRecord,
  type SalesMemberPromotionThreshold,
} from './leader-promotion';
import type { RankType } from '@/lib/types/organization';

const KIM = '3940bcfe-4971-4298-b55c-06cc6da15c9c';
const JO = '12b5230b-68e9-498a-98ea-1285e1a3cd00';

const hasDb =
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

describe.skipIf(!hasDb)('promotion walk audit (integration)', () => {
  it('김세영·조자양 walk·제외 계약 출력', async () => {
    const memberIds = (process.env.AUDIT_MEMBER_IDS ?? `${KIM},${JO}`).split(',').map((s) => s.trim());
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const [{ data: members }, membersRes, edgesRes, { data: contracts }] = await Promise.all([
      db.from('organization_members').select('id, name').in('id', memberIds),
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

    const nameById = new Map((members ?? []).map((m) => [m.id, m.name]));

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
      const st = String(row.status ?? '').trim();
      if (st !== '가입' && st !== '준비' && st !== '대기') continue;
      if (!row.sales_member_id) continue;
      const base = {
        id: row.id,
        contract_code: row.contract_code ?? null,
        unit_count: row.unit_count ?? 0,
        sales_member_id: row.sales_member_id as string,
        join_date: String(row.join_date ?? '').slice(0, 10),
        status: st,
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
      joinAttributed.push({
        ...base,
        happy_call_at: (row.happy_call_at ?? null) as string | null,
      });
    }

    for (const memberId of memberIds) {
      const name = nameById.get(memberId) ?? memberId;
      const { audit } = buildPromotionCommissionWalkForMember(memberId, treeRows, joinAttributed);
      // eslint-disable-next-line no-console
      console.log('\n' + formatPromotionWalkCommissionReport(name, memberId, audit));

      const excluded = auditPromotionWalkExclusionsForMember(
        memberId,
        treeRows,
        joinAttributed,
        joinStatusCandidates,
      );
      if (excluded.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`\n--- ${name} walk 제외 계약 ---`);
        for (const e of excluded) {
          // eslint-disable-next-line no-console
          console.log(`  ${e.contract_code} units=${e.unit_count} reason=${e.exclusion_reason}`);
        }
      }

      const { data: promoEvent } = await db
        .from('leader_promotion_events')
        .select('*')
        .eq('member_id', memberId)
        .maybeSingle();
      if (!promoEvent?.threshold_contract_id) continue;

      const threshold: SalesMemberPromotionThreshold = {
        threshold_contract_id: String(promoEvent.threshold_contract_id),
        threshold_join_date: String(promoEvent.threshold_join_date).slice(0, 10),
      };
      const event: LeaderPromotionEventRecord = {
        member_id: memberId,
        threshold_contract_id: threshold.threshold_contract_id,
        threshold_join_date: threshold.threshold_join_date,
        created_at: (promoEvent.created_at ?? null) as string | null,
      };
      const validation = validatePromotionEvent({
        memberId,
        treeRows,
        joinAttributed,
        joinStatusCandidates,
        event,
        threshold,
      });
      // eslint-disable-next-line no-console
      console.log('\n' + formatPromotionEventAuditReport(validation));
    }
  });
});
