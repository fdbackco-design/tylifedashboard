'use client';

import { useMemo, useState } from 'react';
import SimpleAlertModal from '@/components/ui/SimpleAlertModal';
import { createClient } from '@/lib/supabase/client';

function formatPasswordChangeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code ?? '')
      : '';

  if (
    code === 'invalid_credentials' ||
    /invalid login credentials/i.test(message)
  ) {
    return '현재 비밀번호를 올바르게 입력해주세요.';
  }

  if (
    code === 'weak_password' ||
    /password should be at least 6 characters/i.test(message) ||
    /at least 6 characters/i.test(message)
  ) {
    return '6자 이상 입력해주세요.';
  }

  return message;
}

export default function PasswordChangeClient(props: { loginId: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [nextPassword2, setNextPassword2] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successOpen, setSuccessOpen] = useState(false);

  async function changePassword() {
    if (isSaving) return;
    setErrorMessage('');

    const cur = currentPassword;
    const np = nextPassword.trim();
    const np2 = nextPassword2.trim();

    if (!cur || !np || !np2) {
      setErrorMessage('현재 비밀번호와 새 비밀번호를 모두 입력해주세요.');
      return;
    }
    if (np !== np2) {
      setErrorMessage('새 비밀번호가 서로 일치하지 않습니다.');
      return;
    }
    if (np.length < 6) {
      setErrorMessage('6자 이상 입력해주세요.');
      return;
    }

    setIsSaving(true);
    try {
      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const email = userRes.user?.email;
      if (!email) throw new Error('로그인이 필요합니다.');

      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: cur });
      if (reauthErr) {
        setErrorMessage(formatPasswordChangeError(reauthErr));
        return;
      }

      const { error: updErr } = await supabase.auth.updateUser({ password: np });
      if (updErr) throw updErr;

      const userId = userRes.user?.id;
      if (userId) {
        await supabase
          .from('user_profiles')
          .update({ must_change_password: false })
          .eq('id', userId);
      }

      setSuccessOpen(true);
      setCurrentPassword('');
      setNextPassword('');
      setNextPassword2('');
    } catch (e) {
      setErrorMessage(formatPasswordChangeError(e));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <SimpleAlertModal
        open={successOpen}
        variant="success"
        title="비밀번호 변경 완료"
        message="비밀번호가 변경되었습니다."
        onClose={() => setSuccessOpen(false)}
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.035] sm:p-5">
      <h2 className="text-sm font-semibold text-slate-900 sm:text-base">비밀번호 변경</h2>
      <p className="mt-0.5 text-[11px] text-slate-500">아이디는 변경할 수 없으며, 비밀번호만 수정할 수 있습니다.</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">아이디</label>
          <input
            readOnly
            value={props.loginId || '—'}
            className="w-full rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm tabular-nums text-slate-700"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">현재 비밀번호 *</label>
          <input
            type="password"
            value={currentPassword}
            disabled={isSaving}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-50"
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">새 비밀번호 *</label>
          <input
            type="password"
            value={nextPassword}
            disabled={isSaving}
            onChange={(e) => setNextPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-50"
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">새 비밀번호 확인 *</label>
          <input
            type="password"
            value={nextPassword2}
            disabled={isSaving}
            onChange={(e) => setNextPassword2(e.target.value)}
            className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-50"
            autoComplete="new-password"
          />
        </div>
      </div>

      {errorMessage ? <p className="mt-3 text-sm text-red-600">{errorMessage}</p> : null}

      <button
        type="button"
        onClick={() => void changePassword()}
        disabled={isSaving}
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-lg bg-gradient-to-b from-orange-500 to-orange-600 px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
      >
        {isSaving ? '변경 중…' : '비밀번호 변경'}
      </button>
    </section>
    </>
  );
}
