'use client';

import { useLayoutEffect } from 'react';
import {
  PUSH_NAV_CHANNEL,
  PUSH_NAV_MSG_TYPE,
  applyPushNavigation,
  drainPendingPushNavigation,
} from '@/lib/push/push-navigate-client';

/**
 * 푸시 알림 탭 시 공지 상세 등으로 이동.
 * SW postMessage / BroadcastChannel + sessionStorage로 React 마운트 전 메시지 유실을 방지한다.
 */
export default function PushNotificationNavigate() {
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const onNavigate = (url: unknown) => {
      if (typeof url !== 'string' || !url) return;
      applyPushNavigation(url);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== PUSH_NAV_MSG_TYPE) return;
      onNavigate(data.url);
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(PUSH_NAV_CHANNEL);
      bc.onmessage = (event) => {
        const data = event.data as { type?: string; url?: string } | null;
        if (!data || data.type !== PUSH_NAV_MSG_TYPE) return;
        onNavigate(data.url);
      };
    } catch {
      /* ignore */
    }

    window.addEventListener('message', onMessage);
    navigator.serviceWorker?.addEventListener('message', onMessage);

    const drain = () => {
      void drainPendingPushNavigation();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') drain();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', drain);
    window.addEventListener('focus', drain);

    drain();

    return () => {
      window.removeEventListener('message', onMessage);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', drain);
      window.removeEventListener('focus', drain);
      bc?.close();
    };
  }, []);

  return null;
}
