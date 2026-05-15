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

export const PUSH_NAV_CHANNEL = 'tylife-push-navigate';
export const PUSH_NAV_MSG_TYPE = 'PUSH_NOTIFICATION_NAVIGATE';

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

function broadcastNavigate(path: string): void {
  try {
    const bc = new BroadcastChannel(PUSH_NAV_CHANNEL);
    bc.postMessage({ type: PUSH_NAV_MSG_TYPE, url: path });
    bc.close();
  } catch {
    /* BroadcastChannel 미지원 환경 */
  }
}

function postNavigateToClient(client: Client, path: string): void {
  client.postMessage({ type: PUSH_NAV_MSG_TYPE, url: path });
  broadcastNavigate(path);
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

  // 1) navigate API (Chrome desktop·일부 Android)
  for (const client of sameOrigin) {
    const wc = client as WindowClient;
    if ('navigate' in wc && typeof wc.navigate === 'function') {
      try {
        const next = await wc.navigate(targetHref);
        if (next) {
          postNavigateToClient(next, path);
          await next.focus();
          return;
        }
      } catch {
        /* fall through */
      }
    }
  }

  // 2) 앱이 이미 열려 있으면 메시지 + 포커스 (페이지에서 location.assign 처리)
  if (sameOrigin.length > 0) {
    for (const client of sameOrigin) {
      postNavigateToClient(client, path);
    }
    const first = sameOrigin[0] as WindowClient;
    await first.focus();
    return;
  }

  // 3) 앱이 닫혀 있으면 URL로 새 창/앱 실행 (TWA·PWA cold start)
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
  const path = resolveTargetPath(clickUrl);
  const href = new URL(path, self.location.origin).href;

  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: path, href },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as { url?: string; href?: string } | undefined;
  const url = data?.href ?? data?.url ?? '/organization';
  event.waitUntil(openNotificationUrl(url));
});
