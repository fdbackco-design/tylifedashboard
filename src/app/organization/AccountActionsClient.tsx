'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AccountActionsClient(props: { redirectAfterLogout?: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [nextPassword2, setNextPassword2] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function logout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setMessage(null);
    try {
      await supabase.auth.signOut();
    } finally {
      const to = props.redirectAfterLogout ?? '/login';
      window.location.assign(to);
    }
  }

  async function changePassword() {
    if (isSaving) return;
    setMessage(null);

    const cur = currentPassword;
    const np = nextPassword.trim();
    const np2 = nextPassword2.trim();

    if (!cur || !np || !np2) {
      setMessage({ ok: false, text: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요.' });
      return;
    }
    if (np !== np2) {
      setMessage({ ok: false, text: '새 비밀번호가 서로 일치하지 않습니다.' });
      return;
    }
    if (np.length < 4) {
      setMessage({ ok: false, text: '새 비밀번호는 4자리 이상으로 입력해주세요.' });
      return;
    }

    setIsSaving(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const email = userRes.user?.email;
      if (!email) throw new Error('로그인이 필요합니다.');

      // 현재 비밀번호로 재인증(잘못된 비밀번호면 여기서 실패)
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: cur });
      if (reauthErr) throw reauthErr;

      const { error: updErr } = await supabase.auth.updateUser({ password: np });
      if (updErr) throw updErr;

      setMessage({ ok: true, text: '비밀번호가 변경되었습니다.' });
      setCurrentPassword('');
      setNextPassword('');
      setNextPassword2('');
      setIsOpen(false);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {message ? (
        <span className={`text-xs ${message.ok ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</span>
      ) : null}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="px-3 py-1.5 rounded text-xs border bg-white text-gray-700 border-gray-300 hover:border-gray-400"
      >
        비밀번호 변경
      </button>
      <button
        type="button"
        disabled={isLoggingOut}
        onClick={logout}
        className="px-3 py-1.5 rounded text-xs border bg-white text-gray-700 border-gray-300 hover:border-gray-400 disabled:opacity-50"
      >
        {isLoggingOut ? '로그아웃 중' : '로그아웃'}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              if (isSaving) return;
              setIsOpen(false);
            }}
          />
          <div className="relative w-full max-w-md bg-white rounded-xl border border-gray-200 shadow-lg p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">비밀번호 변경</div>
                <div className="text-xs text-gray-500 mt-0.5">현재 비밀번호 확인 후 변경합니다.</div>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-sm disabled:opacity-50"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <label className="block">
                <div className="text-xs font-medium text-gray-700">현재 비밀번호</div>
                <input
                  type="password"
                  value={currentPassword}
                  disabled={isSaving}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:opacity-50"
                  autoComplete="current-password"
                />
              </label>
              <label className="block">
                <div className="text-xs font-medium text-gray-700">새 비밀번호</div>
                <input
                  type="password"
                  value={nextPassword}
                  disabled={isSaving}
                  onChange={(e) => setNextPassword(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:opacity-50"
                  autoComplete="new-password"
                />
              </label>
              <label className="block">
                <div className="text-xs font-medium text-gray-700">새 비밀번호 확인</div>
                <input
                  type="password"
                  value={nextPassword2}
                  disabled={isSaving}
                  onChange={(e) => setNextPassword2(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm disabled:opacity-50"
                  autoComplete="new-password"
                />
              </label>
            </div>

            {message && !message.ok ? (
              <div className="mt-3 text-xs text-red-600">{message.text}</div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsOpen(false)}
                className="px-3 py-2 rounded-md text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={changePassword}
                className="px-3 py-2 rounded-md text-sm bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50 min-w-[90px]"
              >
                {isSaving ? '변경 중…' : '변경'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

