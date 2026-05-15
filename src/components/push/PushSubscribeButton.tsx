'use client';

import {
  getClientPushSubscriptionPayload,
  isPushSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '@/lib/push/client';
import { useCallback, useEffect, useState } from 'react';

type Props = {
  vapidPublicKey: string;
  className?: string;
  /** true면 환영 영역용 컴팩트(종 아이콘만) */
  compact?: boolean;
};

type Status = 'unsupported' | 'denied' | 'off' | 'on' | 'loading';

function BellIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 sm:h-6 sm:w-6 ${active ? 'text-orange-600' : 'text-slate-400'}`}
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={active ? 0 : 1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  );
}

export default function PushSubscribeButton({ vapidPublicKey, className = '', compact = false }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    const existing = await getClientPushSubscriptionPayload();
    if (existing && Notification.permission === 'granted') {
      setStatus('on');
      return;
    }
    setStatus('off');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function turnOn() {
    if (!vapidPublicKey) {
      setMessage('서버에 VAPID 공개키가 설정되지 않았습니다.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if ('serviceWorker' in navigator && !navigator.serviceWorker.controller) {
        await navigator.serviceWorker.register('/sw.js').catch(() => undefined);
      }
      const payload = await subscribeToWebPush(vapidPublicKey);
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? '구독 저장 실패');
      setStatus('on');
      setMessage('알림이 켜졌습니다.');
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMessage(text);
      if (text.includes('거부')) setStatus('denied');
      else await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      await unsubscribeFromWebPush();
      setStatus('off');
      setMessage('알림이 꺼졌습니다.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (busy || status === 'loading' || status === 'unsupported') return;
    if (status === 'denied') {
      setMessage('브라우저 설정에서 이 사이트의 알림을 허용해주세요.');
      return;
    }
    if (status === 'on') await turnOff();
    else await turnOn();
  }

  const label =
    status === 'on'
      ? '알림 켜짐 — 탭하면 끕니다'
      : status === 'off'
        ? '알림 꺼짐 — 탭하면 켭니다'
        : status === 'denied'
          ? '알림이 차단됨'
          : status === 'unsupported'
            ? '푸시 미지원'
            : '알림 상태 확인 중';

  if (compact) {
    return (
      <div className={`flex flex-col items-end gap-0.5 ${className}`}>
        <button
          type="button"
          disabled={busy || status === 'loading' || status === 'unsupported'}
          onClick={() => void toggle()}
          aria-label={label}
          aria-pressed={status === 'on'}
          title={label}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-50 ${
            status === 'on'
              ? 'border-orange-200 bg-orange-50 hover:bg-orange-100'
              : 'border-slate-200 bg-white/90 hover:bg-slate-50'
          }`}
        >
          {busy ? (
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          ) : (
            <BellIcon active={status === 'on'} />
          )}
          {status === 'on' ? (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white" />
          ) : null}
        </button>
        {message ? (
          <p className="max-w-[10rem] text-right text-[10px] leading-tight text-slate-500">{message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-700">푸시 알림</p>
        <p className="text-[11px] text-slate-500">
          {status === 'on'
            ? '공지·안내 알림을 받는 중입니다.'
            : status === 'denied'
              ? '브라우저에서 알림을 허용해주세요.'
              : '공지 알림을 받으려면 켜주세요.'}
        </p>
        {message ? <p className="mt-1 text-xs text-slate-600">{message}</p> : null}
      </div>
      <button
        type="button"
        disabled={busy || status === 'loading' || status === 'unsupported'}
        onClick={() => void toggle()}
        aria-label={label}
        aria-pressed={status === 'on'}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-50 ${
          status === 'on'
            ? 'border-orange-200 bg-orange-50 hover:bg-orange-100'
            : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
      >
        {busy ? (
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        ) : (
          <BellIcon active={status === 'on'} />
        )}
      </button>
    </div>
  );
}
