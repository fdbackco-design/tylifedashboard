/**
 * POST /api/sync/run
 *
 * 타임아웃 방지를 위해 페이지 단위로 분할 처리.
 * 클라이언트가 hasMore=true인 동안 반복 호출한다.
 *
 * body:
 *   {}                         → 새 sync_run 생성 + 1페이지 처리
 *   { runId, page }            → 기존 run에서 지정 페이지 처리
 *   { runId, finish: true }    → run 완료 처리만 (마지막 호출)
 *
 * response:
 *   { runId, page, fetched, created, updated, errors, hasMore }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { syncContractPage } from '@/lib/tylife/sync-service';
import type { SyncRun } from '@/lib/types/sync';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!process.env.TYLIFE_COOKIE) {
    return NextResponse.json(
      { success: false, error: 'TYLIFE_COOKIE 환경변수가 설정되지 않았습니다.' },
      { status: 503 },
    );
  }

  let body: { runId?: string; page?: number; finish?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // body 없으면 새 동기화 시작
  }

  const db = createAdminSupabaseClient();

  // ── 완료 처리 전용 호출 ──────────────────────────────
  if (body.finish && body.runId) {
    const { data: run } = await db
      .from('sync_runs')
      .select('total_fetched, total_created, total_updated, total_errors')
      .eq('id', body.runId)
      .single();

    const totals = run as {
      total_fetched: number;
      total_created: number;
      total_updated: number;
      total_errors: number;
    } | null;

    const allFailed =
      totals &&
      totals.total_errors > 0 &&
      totals.total_fetched === totals.total_errors;

    await db
      .from('sync_runs')
      .update({
        status: allFailed ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
      })
      .eq('id', body.runId);

    return NextResponse.json({ success: true, runId: body.runId, finished: true });
  }

  // ── 새 run 생성 또는 기존 run 이어서 ──────────────────
  let runId = body.runId;
  const page = body.page ?? 1;

  if (!runId) {
    const { data, error } = await db
      .from('sync_runs')
      .insert({ status: 'running', triggered_by: 'ui' })
      .select('id')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: `sync_run 생성 실패: ${error?.message}` },
        { status: 500 },
      );
    }
    runId = (data as SyncRun).id;
  }

  // ── 단일 페이지 동기화 ────────────────────────────────
  try {
    const result = await syncContractPage(page, {}, runId);

    // 누적 합산을 sync_runs에 업데이트
    const { data: existing } = await db
      .from('sync_runs')
      .select('total_fetched, total_created, total_updated, total_errors')
      .eq('id', runId)
      .single();

    const prev = existing as {
      total_fetched: number | null;
      total_created: number | null;
      total_updated: number | null;
      total_errors: number | null;
    } | null;

    await db
      .from('sync_runs')
      .update({
        total_fetched: (prev?.total_fetched ?? 0) + result.fetched,
        total_created: (prev?.total_created ?? 0) + result.created,
        total_updated: (prev?.total_updated ?? 0) + result.updated,
        total_errors: (prev?.total_errors ?? 0) + result.errors,
      })
      .eq('id', runId);

    return NextResponse.json({
      success: true,
      runId,
      page,
      fetched: result.fetched,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
      hasMore: result.hasMore,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    try {
      await db
        .from('sync_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', runId);
    } catch {
      // DB 업데이트 실패해도 응답은 반드시 반환
    }

    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
