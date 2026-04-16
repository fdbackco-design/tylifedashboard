import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  const limitRaw = url.searchParams.get('limit') ?? '20';
  const limit = Math.max(1, Math.min(200, Number.parseInt(limitRaw, 10) || 20));

  if (!runId) {
    return NextResponse.json({ success: false, error: 'runId가 필요합니다.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { data, error } = await db
    .from('sync_logs')
    .select('id, created_at, level, message, context')
    .eq('run_id', runId)
    .in('level', ['warn', 'error'])
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, runId, data: data ?? [] });
}

