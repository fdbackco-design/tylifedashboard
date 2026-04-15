import { NextRequest, NextResponse } from 'next/server';
import { fetchContractDetailHtml } from '@/lib/tylife/client';
import { parseContractDetailHtml, normalizeDate } from '@/lib/tylife/html-parser';
import {
  DEFAULT_ITEM_NAME_PLACEHOLDER,
  normalizeJoinMethod,
  normalizeWatchFit,
} from '@/lib/tylife/normalize';

export const dynamic = 'force-dynamic';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { tries: number; baseDelayMs: number; label: string },
): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= opts.tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === opts.tries) break;
      const wait = opts.baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[backfill-invoice] ${opts.label} 실패 — ${attempt}/${opts.tries} 재시도 (${wait}ms)`);
      await sleep(wait);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const c = Math.max(1, Math.floor(concurrency));
  const results: R[] = new Array(items.length) as R[];
  let idx = 0;

  const runners = Array.from({ length: Math.min(c, items.length) }, async () => {
    while (true) {
      const my = idx++;
      if (my >= items.length) break;
      results[my] = await worker(items[my]);
    }
  });

  await Promise.all(runners);
  return results;
}

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const secret = process.env.SYNC_API_SECRET;

  if (!secret) return false;

  const encoder = new TextEncoder();
  const tokenBytes = encoder.encode(token);
  const secretBytes = encoder.encode(secret);

  if (tokenBytes.length !== secretBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < tokenBytes.length; i++) {
    diff |= tokenBytes[i] ^ secretBytes[i];
  }
  return diff === 0;
}

/**
 * POST /api/sync/backfill-invoice
 *
 * 목적:
 * - 기존 contracts 중 invoice_no 가 NULL 인 건들을 대상으로
 *   TY Life 상세 페이지(/contract/{external_id})를 재조회하여 invoice_no 를 채움.
 *
 * Authorization: Bearer {SYNC_API_SECRET}
 *
 * body:
 * - limit?: number        (default 50, max 200)
 * - cursor?: string|null  (다음 페이지 시작점 — 마지막으로 처리한 contracts.id)
 * - concurrency?: number  (default 3, max 8)
 * - scope?: 'needs_detail' | 'all' | 'missing_invoice' | 'placeholder_item_name'
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    limit?: number;
    cursor?: string | null;
    concurrency?: number;
    scope?: 'needs_detail' | 'all' | 'missing_invoice' | 'placeholder_item_name';
  } = {};
  try {
    body = await req.json();
  } catch {
    // ignore
  }

  const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
  const cursor = body.cursor ?? null;
  const concurrency = Math.min(Math.max(body.concurrency ?? 3, 1), 8);
  const scope = body.scope ?? 'needs_detail';

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  let q = db
    .from('contracts')
    .select('id, contract_code, external_id')
    .not('external_id', 'is', null)
    .order('id', { ascending: true })
    .limit(limit);

  if (scope === 'needs_detail') {
    q = q.or(`invoice_no.is.null,item_name.eq.${JSON.stringify(DEFAULT_ITEM_NAME_PLACEHOLDER)}`);
  } else if (scope === 'missing_invoice') {
    q = q.is('invoice_no', null);
  } else if (scope === 'placeholder_item_name') {
    q = q.eq('item_name', DEFAULT_ITEM_NAME_PLACEHOLDER);
  } else if (scope === 'all') {
    // no extra filter
  }

  if (cursor) {
    q = q.gt('id', cursor);
  }

  const { data: targets, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (targets ?? []) as Array<{
    id: string;
    contract_code: string;
    external_id: string | null;
  }>;

  const mismatches: Array<{ contract_id: string; external_id: string; contractNo: string }> = [];
  const errors: Array<{ contract_id: string; external_id: string; error: string }> = [];

  const outcomes = await runWithConcurrency(rows, concurrency, async (row) => {
    if (!row.external_id) return { processed: 0, updatedInvoice: 0 };

    try {
      let html = await withRetry(
        () => fetchContractDetailHtml(row.external_id as string),
        { tries: 3, baseDelayMs: 400, label: `detail(${row.external_id})` },
      );

      // 계약 상세 URL id vs 페이지 하단 script(contractNo) 불일치 점검
      const m = html.match(/contractNo\s*[:=]\s*['"]?(\d+)/i);
      if (m?.[1] && m[1] !== row.external_id) {
        mismatches.push({ contract_id: row.id, external_id: row.external_id, contractNo: m[1] });
        // 실제 상세 화면이 내부적으로 다른 contractNo를 기준으로 렌더링하는 케이스가 있어,
        // contractNo를 따라 한 번 더 조회해 정확한 HTML로 백필한다.
        html = await withRetry(
          () => fetchContractDetailHtml(m[1]),
          { tries: 3, baseDelayMs: 400, label: `detail(contractNo:${m[1]})` },
        );
      }

      const detail = parseContractDetailHtml(html, row.contract_code);
      const patch: Record<string, unknown> = {};

      if (detail.invoice_no) patch.invoice_no = detail.invoice_no;
      if (detail.rental_request_no) patch.rental_request_no = detail.rental_request_no;
      if (detail.item_name) patch.item_name = detail.item_name;
      if (detail.unit_count != null && detail.unit_count > 0) patch.unit_count = detail.unit_count;
      if (detail.join_method) patch.join_method = normalizeJoinMethod(detail.join_method);
      if (detail.watch_fit) patch.watch_fit = normalizeWatchFit(detail.watch_fit);
      if (detail.happy_call_at) patch.happy_call_at = normalizeDate(detail.happy_call_at);
      if (detail.contractor_name) patch.contractor_name = detail.contractor_name;
      if (detail.beneficiary_name) patch.beneficiary_name = detail.beneficiary_name;
      if (detail.relationship_to_contractor)
        patch.relationship_to_contractor = detail.relationship_to_contractor;

      if (Object.keys(patch).length > 0) {
        await withRetry(
          async () => {
            const { error: uErr } = await db.from('contracts').update(patch).eq('id', row.id);
            if (uErr) throw new Error(uErr.message);
          },
          { tries: 3, baseDelayMs: 250, label: `update(${row.id})` },
        );
        return { processed: 1, updatedInvoice: patch.invoice_no ? 1 : 0 };
      }

      return { processed: 1, updatedInvoice: 0 };
    } catch (e) {
      errors.push({
        contract_id: row.id,
        external_id: row.external_id,
        error: e instanceof Error ? e.message : String(e),
      });
      return { processed: 1, updatedInvoice: 0 };
    }
  });

  const processed = outcomes.reduce((a, b) => a + b.processed, 0);
  const updated = outcomes.reduce((a, b) => a + b.updatedInvoice, 0);
  const next_cursor = rows.length > 0 ? rows[rows.length - 1]?.id ?? null : null;

  return NextResponse.json({
    success: true,
    limit,
    cursor,
    next_cursor,
    concurrency,
    scope,
    processed,
    updated_invoice_no: updated,
    mismatches,
    errors,
  });
}

