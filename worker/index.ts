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

declare const self: ServiceWorkerGlobalScope;

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
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url ?? '/organization' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url =
    (event.notification.data as { url?: string } | undefined)?.url ?? '/organization';
  const target = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
