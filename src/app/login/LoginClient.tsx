'use client';

import { useEffect, useMemo, useState } from 'react';
import TyLifePartnersLogo from '@/components/TyLifePartnersLogo';
import { createClient } from '@/lib/supabase/client';

const REMEMBER_LOGIN_CODE_KEY = 'auth.remember_login_code';
const SAVED_LOGIN_CODE_KEY = 'auth.saved_login_code';

export default function LoginClient(props: { redirect: string }) {
  const redirect = useMemo(() => props.redirect, [props.redirect]);
  const supabase = useMemo(() => createClient(), []);

  const [loginCode, setLoginCode] = useState('');
  const [password, setPassword] = useState('');
  const [rememberLoginCode, setRememberLoginCode] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const remember = localStorage.getItem(REMEMBER_LOGIN_CODE_KEY);
      const rememberOn = remember == null ? true : remember === '1';
      setRememberLoginCode(rememberOn);
      if (rememberOn) {
        const saved = localStorage.getItem(SAVED_LOGIN_CODE_KEY);
        if (saved && !loginCode) setLoginCode(saved);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    let navigated = false;
    try {
      const emailDomain = 'tylifedashboard.local';
      const loginEmail = loginCode.includes('@') ? loginCode.trim() : `${loginCode.trim()}@${emailDomain}`;
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: password,
      });
      if (signErr) throw signErr;

      try {
        localStorage.setItem(REMEMBER_LOGIN_CODE_KEY, rememberLoginCode ? '1' : '0');
        if (rememberLoginCode) localStorage.setItem(SAVED_LOGIN_CODE_KEY, loginCode.trim());
        else localStorage.removeItem(SAVED_LOGIN_CODE_KEY);
      } catch {
        // ignore
      }

      // SSR이 세션 쿠키를 즉시 인식하도록, 클라이언트 라우팅 대신 full navigation 사용
      navigated = true;
      // 로그인 진입점은 /login 하나로 통일하고, 로그인 성공 후에는 권한에 따라 서버에서 분기한다.
      // (redirect 쿼리가 있더라도 /admin은 admin만 접근 가능하므로 최종 분기는 서버에서 결정)
      const qs = new URLSearchParams();
      if (redirect) qs.set('redirect', redirect);
      const to = qs.toString() ? `/login/redirect?${qs.toString()}` : '/login/redirect';
      window.location.assign(to);
      return;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // navigation을 시작한 경우(성공)에는 loading을 유지해 “로그인 중 → 로그인” 깜빡임 방지
      if (!navigated) setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 gap-8">
      <TyLifePartnersLogo variant="hero" className="mx-auto" priority />
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">로그인</h1>
        <p className="text-sm text-gray-600 mb-4">발급된 계정으로 로그인해주세요.</p>

          {loading ? (
            <div className="mb-4 px-3 py-2 rounded border border-slate-200 bg-slate-50 text-slate-700 text-sm">
              처리중…
            </div>
          ) : null}

        {error ? (
          <div className="mb-4 px-3 py-2 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <div className="text-sm font-medium text-gray-700">ID</div>
            <input
              id="loginCode"
              name="username"
              value={loginCode}
              onChange={(e) => setLoginCode(e.target.value)}
              disabled={loading}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:opacity-50"
              placeholder="8자리 숫자"
              autoComplete="username"
            />
          </label>
          <label className="block">
            <div className="text-sm font-medium text-gray-700">비밀번호</div>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:opacity-50"
              placeholder="비밀번호"
              autoComplete="current-password"
            />
          </label>

          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={rememberLoginCode}
              onChange={(e) => setRememberLoginCode(e.target.checked)}
              disabled={loading}
            />
            ID 기억하기 (이 기기)
          </label>

          <button
            type="submit"
            disabled={loading || !loginCode.trim() || !password}
            aria-busy={loading}
            className="w-full bg-slate-800 text-white rounded-md py-2.5 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '로그인 중' : '로그인'}
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-gray-200 text-xs text-gray-500 flex items-center justify-between gap-3">
          <a href="/privacy" className="text-orange-600 hover:underline">
            개인정보처리방침
          </a>
          <span className="whitespace-nowrap">© TY Life Partners</span>
        </div>
      </div>
    </div>
  );
}

