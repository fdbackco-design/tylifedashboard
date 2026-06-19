'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const NOTICE_MESSAGE =
  '초기 비밀번호는 등록된 휴대폰 번호와 동일합니다. 개인정보 보호를 위해 최초 로그인 후 반드시 비밀번호를 변경해 주세요.\n비밀번호를 변경하지 않으면 휴대폰 번호를 아는 타인이 로그인할 수 있습니다.';

/** 초기 비밀번호(아이디·휴대폰 번호 동일) 사용자 대상 /organization 접속 안내 */
export default function PasswordChangeNoticeModal(props: { open: boolean }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const open = props.open && !dismissed;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-change-notice-title"
    >
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={() => setDismissed(true)}
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl ring-1 ring-slate-900/10 sm:p-6">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h2 id="password-change-notice-title" className="mt-4 text-center text-lg font-bold text-slate-900">
          비밀번호 변경 안내
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-slate-600 break-keep whitespace-pre-line">
          {NOTICE_MESSAGE}
        </p>
        <button
          type="button"
          onClick={() => router.push('/organization/password')}
          className="mt-5 w-full rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
        >
          비밀번호 변경하기
        </button>
      </div>
    </div>
  );
}
