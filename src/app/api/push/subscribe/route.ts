import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getAuthedUserIdFromRequest } from '@/lib/push/auth';
import type { PushSubscribeBody } from '@/lib/push/types';

function parseBody(body: unknown): PushSubscribeBody | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const endpoint = String(b.endpoint ?? '').trim();
  const keys = b.keys as Record<string, unknown> | undefined;
  const p256dh = String(keys?.p256dh ?? '').trim();
  const auth = String(keys?.auth ?? '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const userId = await getAuthedUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const sub = parseBody(body);
  if (!sub) {
    return NextResponse.json({ success: false, error: 'Invalid subscription' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const userAgent = req.headers.get('user-agent')?.slice(0, 500) ?? null;

  const { data: existing } = await db
    .from('push_subscriptions')
    .select('id,user_id')
    .eq('endpoint', sub.endpoint)
    .maybeSingle();

  if (existing && (existing as { user_id: string }).user_id === userId) {
    return NextResponse.json({ success: true, data: { id: (existing as { id: string }).id, duplicate: true } });
  }

  const { data, error } = await db
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: userAgent,
      },
      { onConflict: 'endpoint' },
    )
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { id: (data as { id: string }).id, duplicate: false } });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const userId = await getAuthedUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const endpoint = String((body as { endpoint?: string })?.endpoint ?? '').trim();
  if (!endpoint) {
    return NextResponse.json({ success: false, error: 'endpoint가 필요합니다.' }, { status: 400 });
  }

  const db = createAdminSupabaseClient();
  const { error } = await db
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
