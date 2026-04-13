import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server Component / Route Handler용 Supabase 클라이언트.
 * anon key 사용 (RLS 적용).
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component에서 호출된 경우 set 불가 (무시)
          }
        },
      },
    },
  );
}

/**
 * 서버 전용 관리자 클라이언트 (service_role).
 * RLS 우회 가능 — sync-service, 정산 계산 등 서버 로직 전용.
 * Route Handler / Server Action 외부에서 절대 사용 금지.
 */
export function createAdminSupabaseClient() {
  // 동적 import 대신 @supabase/supabase-js 직접 사용
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
