'use client';

/** VAPID public key (URL-safe base64) → Uint8Array for PushManager.subscribe */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export type ClientPushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export async function getClientPushSubscriptionPayload(): Promise<ClientPushSubscriptionPayload | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

export async function subscribeToWebPush(vapidPublicKey: string): Promise<ClientPushSubscriptionPayload> {
  if (!isPushSupported()) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  if (!vapidPublicKey) throw new Error('VAPID 공개키가 설정되지 않았습니다.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '알림 권한이 거부되었습니다. 브라우저 설정에서 알림을 허용해주세요.'
        : '알림 권한이 필요합니다.',
    );
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    });
  }

  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('구독 정보를 읽을 수 없습니다.');
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}
