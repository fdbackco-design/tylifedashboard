import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUserProfileFromRequest } from '@/lib/admin-auth';
import { issueSelectedSalesCodes } from '@/lib/sales-code/issuance-service';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const admin = await getAuthedUserProfileFromRequest(req);
  if (!admin?.is_active || admin.role !== 'admin') {
    return jsonNoStore({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonNoStore({ ok: false, error: 'JSON body 필요' }, { status: 400 });
  }
  const ids = [
    ...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .map((value) => typeof value === 'string' ? value.trim() : '')
        .filter((value) => UUID.test(value)),
    ),
  ];
  if (ids.length === 0) {
    return jsonNoStore({ ok: false, error: '발급할 항목을 선택하세요.' }, { status: 400 });
  }
  if (ids.length > 100) {
    return jsonNoStore(
      { ok: false, error: '한 번에 최대 100건까지 발급할 수 있습니다.' },
      { status: 400 },
    );
  }

  try {
    const result = await issueSelectedSalesCodes(createAdminSupabaseClient(), {
      ids,
      admin: {
        id: admin.id,
        name: admin.display_name?.trim() || 'admin',
      },
    });
    return jsonNoStore({
      ok: result.failedCount === 0,
      total_count: result.totalCount,
      success_count: result.successCount,
      failed_count: result.failedCount,
      skipped_count: result.skippedCount,
      results: result.results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[sales-code-issuance:error]', message);
    return jsonNoStore(
      { ok: false, error: message, message: '발급 처리 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
