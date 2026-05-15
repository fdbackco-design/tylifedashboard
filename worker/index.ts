/// <reference lib="webworker" />
/**
 * next-pwa가 생성한 Workbox SW에 import되는 커스텀 워커.
 * PWA 캐싱 로직은 건드리지 않고 push / notificationclick 만 처리한다.
 */

export type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
};

/** organization 앱에서 service worker → 클라이언트 라우팅 */
export const PUSH_NOTIFICATION_NAVIGATE = 'PUSH_NOTIFICATION_NAVIGATE';

declare const self: ServiceWorkerGlobalScope;

function resolveTargetPath(url: string): string {
  try {
    const u = new URL(url, self.location.origin);
    if (u.origin !== self.location.origin) return '/organization';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/organization';
  }
}

async function openNotificationUrl(url: string): Promise<void> {
  const path = resolveTargetPath(url);
  const targetHref = new URL(path, self.location.origin).href;

  const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const sameOrigin = windowClients.filter((c) => {
    try {
      return new URL(c.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });

  for (const client of sameOrigin) {
    const wc = client as WindowClient;
    if ('navigate' in wc && typeof wc.navigate === 'function') {
      try {
        const focused = await wc.navigate(targetHref);
        if (focused) {
          await focused.focus();
          return;
        }
      } catch {
        // navigate 미지원·실패 시 postMessage / openWindow 로 폴백
      }
    }
  }

  if (sameOrigin.length > 0) {
    const wc = sameOrigin[0] as WindowClient;
    wc.postMessage({ type: PUSH_NOTIFICATION_NAVIGATE, url: path });
    await wc.focus();
    return;
  }

  if (self.clients.openWindow) {
    await self.clients.openWindow(targetHref);
  }
}

self.addEventListener('push', (event: PushEvent) => {
  const fallback: PushPayload = {
    title: 'TY Life',
    body: '',
    url: '/organization',
  };
  let payload: PushPayload = fallback;
  try {
    if (event.data) {
      payload = { ...fallback, ...(event.data.json() as PushPayload) };
    }
  } catch {
    const text = event.data?.text();
    if (text) payload.body = text;
  }

  const title = payload.title ?? fallback.title!;
  const clickUrl = payload.url ?? '/organization';
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: clickUrl },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url =
    (event.notification.data as { url?: string } | undefined)?.url ?? '/organization';
  event.waitUntil(openNotificationUrl(url));
});
