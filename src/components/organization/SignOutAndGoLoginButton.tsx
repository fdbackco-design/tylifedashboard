'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * "권한 없음" 화면 등에서 사용하는 "로그인으로 돌아가기" 버튼.
 * - 클릭 시 Supabase Auth 세션을 종료(`signOut`)해 SSR 쿠키까지 정리한 뒤
 *   `/login`으로 full navigation 한다.
 * - signOut이 실패해도 로그인 페이지로 이동해 막힌 흐름을 빠져나갈 수 있도록 한다.
 */
export default function SignOutAndGoLoginButton(props: { className?: string; label?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
    } catch {
      // 세션 정리에 실패해도 로그인 페이지로 이동시켜 사용자가 갇히지 않게 한다.
    } finally {
      window.location.assign('/login');
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className={
        props.className ??
        'mt-2 inline-block text-sm text-blue-600 underline disabled:cursor-wait disabled:opacity-60'
      }
    >
      {busy ? '로그아웃 중…' : (props.label ?? '로그인으로 돌아가기')}
    </button>
  );
}
