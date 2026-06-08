import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { isAdminAuthed } from '@/lib/admin-auth';
import { syncAccountIssueFromGoogleSheet } from '@/lib/account-issue/sheet-sync';

/**
 * Google Sheets '시트1' 기반 자동 계정 발급 동기화.
 * - 관리자만 호출 가능
 * - 환경변수 ACCOUNT_ISSUE_SHEET_ID / ACCOUNT_ISSUE_SHEET_NAME 사용
 * - 응답에 비밀번호 원문은 포함하지 않는다(loginId 마스킹)
 */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await isAdminAuthed(req))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const db = createAdminSupabaseClient();
  try {
    const result = await syncAccountIssueFromGoogleSheet(db);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error('[sync-sheet] 처리 실패:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
