/**
 * POST /api/sync — 수동 동기화 실행
 * GET  /api/sync — 최근 sync_runs 조회
 *
 * Authorization: Bearer {SYNC_API_SECRET} 헤더 필수.
 *
 * POST body:
 *   mode?        : 'auto' | 'manual'
 *   rowPerPage?  : number  (기본 50)
 *   maxPage?     : number  (미설정 시 전체)
 *   dryRun?      : boolean (기본 false)
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSync } from '@/lib/tylife/sync-service';

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const secret = process.env.SYNC_API_SECRET;

  if (!secret) {
    console.error('[api/sync] SYNC_API_SECRET 환경변수 미설정');
    return false;
  }

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    mode?: string;
    rowPerPage?: number;
    maxPage?: number;
    dryRun?: boolean;
  } = {};

  try {
    body = await req.json();
  } catch {
    // body 없는 경우 기본값 사용
  }

  const triggeredBy = body.mode === 'auto' ? 'cron' : 'manual';

  try {
    const result = await runSync({
      triggeredBy,
      rowPerPage: body.rowPerPage,
      maxPage: body.maxPage,
      dryRun: body.dryRun,
    });
    return NextResponse.json({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sync] 동기화 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { createAdminSupabaseClient } = await import('@/lib/supabase/server');
  const db = createAdminSupabaseClient();

  const { data, error } = await db
    .from('sync_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
