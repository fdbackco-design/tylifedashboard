import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const db = createAdminSupabaseClient();
  const url = new URL(req.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page') ?? '1')) || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Math.floor(Number(url.searchParams.get('page_size') ?? '20')) || 20),
  );
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    let query = db
      .from('user_profiles')
      .select(
        'id, customer_id, member_id, login_code, display_name, phone, role, is_active, must_change_password, created_at, updated_at',
        { count: 'exact' },
      );
    if (search) {
      // PostgREST or 필터 구문에 쓰이는 문자는 제거해 필터 삽입을 막는다.
      const safeSearch = search.replace(/[,%()]/g, ' ').trim();
      if (safeSearch) {
        const filters = [
          `display_name.ilike.%${safeSearch}%`,
          `phone.ilike.%${safeSearch}%`,
          `login_code.ilike.%${safeSearch}%`,
        ];
        const phoneDigits = safeSearch.replace(/\D/g, '');
        if (phoneDigits.length >= 3) {
          filters.push(`phone.ilike.%${phoneDigits.split('').join('%')}%`);
        }
        query = query.or(filters.join(','));
      }
    }
    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const total = count ?? 0;
    return NextResponse.json({
      success: true,
      data: {
        items: data ?? [],
        pagination: {
          page,
          page_size: pageSize,
          total,
          total_pages: Math.max(1, Math.ceil(total / pageSize)),
        },
      },
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

