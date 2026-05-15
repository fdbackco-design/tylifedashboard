import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { NOTICE_CATEGORIES, NOTICE_PAGE_SIZE } from '@/lib/notices/constants';
import { getNoticeDisplayStatus } from '@/lib/notices/status';
import type { NoticeListItem, NoticeRow } from '@/lib/notices/types';
import { assertPinnedLimit, parseNoticeCategory, parseOptionalDate } from '@/lib/notices/validation';

function mapListItem(row: NoticeRow, attachmentCount: number): NoticeListItem {
  return {
    ...row,
    display_status: getNoticeDisplayStatus(row),
    attachment_count: attachmentCount,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const q = (sp.get('q') ?? '').trim();
  const category = sp.get('category') ?? '';
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const pageSize = NOTICE_PAGE_SIZE;

  const db = createAdminSupabaseClient();
  let query = db.from('notices').select('*', { count: 'exact' }).order('created_at', { ascending: false });

  if (category && category !== 'all' && (NOTICE_CATEGORIES as readonly string[]).includes(category)) {
    query = query.eq('category', category);
  }
  if (q) query = query.ilike('title', `%${q}%`);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const rows = (data ?? []) as NoticeRow[];
  const ids = rows.map((r) => r.id);
  const attachCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: atts } = await db.from('notice_attachments').select('notice_id').in('notice_id', ids);
    for (const a of atts ?? []) {
      const nid = String((a as { notice_id: string }).notice_id);
      attachCounts.set(nid, (attachCounts.get(nid) ?? 0) + 1);
    }
  }

  const items = rows.map((r) => mapListItem(r, attachCounts.get(r.id) ?? 0));

  const { count: publishedCount } = await db
    .from('notices')
    .select('id', { count: 'exact', head: true })
    .eq('is_draft', false)
    .eq('is_stopped', false);

  return NextResponse.json({
    success: true,
    data: {
      items,
      total: count ?? 0,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil((count ?? 0) / pageSize)),
      stats: {
        total: count ?? 0,
        publishedApprox: publishedCount ?? 0,
      },
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const category = parseNoticeCategory(body.category);
  if (!category) {
    return NextResponse.json({ success: false, error: '분류를 선택해주세요.' }, { status: 400 });
  }

  const title = String(body.title ?? '').trim();
  if (!title) {
    return NextResponse.json({ success: false, error: '제목을 입력해주세요.' }, { status: 400 });
  }

  const isPinned = Boolean(body.is_pinned);
  const db = createAdminSupabaseClient();
  const pinErr = await assertPinnedLimit(db, { isPinned });
  if (pinErr) return NextResponse.json({ success: false, error: pinErr }, { status: 400 });

  const isDraft = body.is_draft !== false;
  const publishStart = parseOptionalDate(body.publish_start);
  const publishEnd = parseOptionalDate(body.publish_end);

  const { data, error } = await db
    .from('notices')
    .insert({
      category,
      title,
      content: String(body.content ?? ''),
      is_pinned: isPinned,
      send_push: Boolean(body.send_push),
      is_draft: isDraft,
      is_stopped: false,
      publish_start: publishStart,
      publish_end: publishEnd,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const row = data as NoticeRow;
  return NextResponse.json({
    success: true,
    data: mapListItem(row, 0),
  });
}
