'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const MSG_TYPE = 'PUSH_NOTIFICATION_NAVIGATE';

/**
 * Service Worker notificationclick 폴백: 앱이 열려 있을 때 Next.js 라우터로 이동.
 * (공지 푸시 → /organization/notice/[id] 등)
 */
export default function PushNotificationNavigate() {
  const router = useRouter();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== MSG_TYPE || typeof data.url !== 'string') return;
      const path = data.url.startsWith('/') ? data.url : `/${data.url}`;
      router.push(path);
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

  return null;
}
