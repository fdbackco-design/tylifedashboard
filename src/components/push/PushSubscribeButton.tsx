'use client';

import LoadingButton from '@/components/ui/LoadingButton';
import {
  getClientPushSubscriptionPayload,
  isPushSupported,
  subscribeToWebPush,
} from '@/lib/push/client';
import { useCallback, useEffect, useState } from 'react';

type Props = {
  vapidPublicKey: string;
  className?: string;
};

type Status = 'unsupported' | 'denied' | 'default' | 'subscribed' | 'loading';

export default function PushSubscribeButton({ vapidPublicKey, className = '' }: Props) {
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
      setStatus('subscribed');
      return;
    }
    setStatus('default');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enablePush() {
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
      const json = (await res.json()) as { success?: boolean; error?: string; data?: { duplicate?: boolean } };
      if (!res.ok || !json.success) throw new Error(json.error ?? '구독 저장 실패');
      setStatus('subscribed');
      setMessage(json.data?.duplicate ? '이미 알림이 등록된 기기입니다.' : '알림이 활성화되었습니다.');
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMessage(text);
      if (text.includes('거부')) setStatus('denied');
      else await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading') {
    return <p className={`text-xs text-slate-500 ${className}`}>알림 상태 확인 중…</p>;
  }

  if (status === 'unsupported') {
    return (
      <p className={`text-xs text-slate-500 ${className}`}>
        이 환경에서는 푸시 알림을 사용할 수 없습니다. (PWA 설치·HTTPS 필요)
      </p>
    );
  }

  if (status === 'denied') {
    return (
      <p className={`text-xs text-amber-700 ${className}`}>
        알림이 차단되어 있습니다. 브라우저 또는 기기 설정에서 이 사이트의 알림을 허용해주세요.
      </p>
    );
  }

  if (status === 'subscribed') {
    return (
      <div className={className}>
        <p className="text-xs font-medium text-emerald-700">✓ 푸시 알림이 켜져 있습니다</p>
        {message ? <p className="mt-1 text-xs text-slate-500">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <LoadingButton
        type="button"
        isLoading={busy}
        onClick={() => void enablePush()}
        className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-100 disabled:opacity-50"
      >
        알림 허용
      </LoadingButton>
      <p className="text-[11px] leading-snug text-slate-500">
        공지·안내 알림을 받습니다. 계약·개인정보는 푸시 본문에 포함되지 않습니다.
      </p>
      {message ? <p className="text-xs text-red-600">{message}</p> : null}
    </div>
  );
}
