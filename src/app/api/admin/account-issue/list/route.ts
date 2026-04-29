import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthed(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const db = createAdminSupabaseClient();

  try {
    const { data } = await db
      .from('user_profiles')
      .select('id, customer_id, member_id, login_code, display_name, phone, role, is_active, must_change_password, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

