import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAdminAuthed(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const memberId = String(req.nextUrl.searchParams.get('member_id') ?? '').trim();
  if (!memberId) return NextResponse.json({ success: false, error: 'member_id required' }, { status: 400 });

  const db = createAdminSupabaseClient();

  const { data, error } = await db
    .from('user_profiles')
    .select('id, customer_id, member_id, login_code, display_name, phone, is_active, must_change_password, role, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ success: true, data: null });
  }

  return NextResponse.json({ success: true, data });
}

