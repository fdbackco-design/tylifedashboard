'use client';

const SW_READY_TIMEOUT_MS = 20_000;
const SUBSCRIBE_TIMEOUT_MS = 20_000;
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  message: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal, credentials: 'include', cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(message);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

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

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iPhoneLike = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iPhoneLike || iPadOs;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true
  );
}

/** 아이폰은 홈 화면 앱(PWA)에서만 Web Push가 동작한다. */
export function getIosPushBlockReason(): string | null {
  if (!isIosDevice()) return null;
  if (isStandaloneDisplay()) return null;
  return '아이폰은 Safari에서 바로 알림을 켤 수 없습니다. 공유 버튼 → "홈 화면에 추가" 후, 홈 화면 앱에서 다시 알림을 켜 주세요.';
}

export type ClientPushSubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function payloadFromSubscription(sub: PushSubscription): ClientPushSubscriptionPayload | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

async function getPushRegistration(waitForController = false): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('이 브라우저는 서비스 워커를 지원하지 않습니다.');
  }

  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  }

  const ready = await withTimeout(
    navigator.serviceWorker.ready,
    SW_READY_TIMEOUT_MS,
    '서비스 워커가 준비되지 않았습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.',
  );

  // iOS: 페이지가 SW에 제어되지 않으면 subscribe()가 무한 대기하는 경우가 있다.
  if (waitForController && !navigator.serviceWorker.controller) {
    await withTimeout(
      new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      }),
      6_000,
      '서비스 워커가 이 페이지를 아직 제어하지 않습니다. 새로고침한 뒤 다시 알림을 켜 주세요.',
    ).catch(() => undefined);
  }

  return ready;
}

export async function getClientPushSubscriptionPayload(): Promise<ClientPushSubscriptionPayload | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await getPushRegistration(false);
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    return payloadFromSubscription(sub);
  } catch {
    return null;
  }
}

export async function persistPushSubscription(payload: ClientPushSubscriptionPayload): Promise<void> {
  const res = await fetchWithTimeout(
    '/api/push/subscribe',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    '구독 저장 요청이 시간 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
  );
  const json = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || !json.success) throw new Error(json.error ?? '구독 저장 실패');
}

export async function subscribeToWebPush(vapidPublicKey: string): Promise<ClientPushSubscriptionPayload> {
  const iosBlock = getIosPushBlockReason();
  if (iosBlock) throw new Error(iosBlock);
  if (!isPushSupported()) throw new Error('이 브라우저는 푸시 알림을 지원하지 않습니다.');
  if (!vapidPublicKey) throw new Error('VAPID 공개키가 설정되지 않았습니다.');

  const keyBytes = urlBase64ToUint8Array(vapidPublicKey);
  if (keyBytes.byteLength !== 65) {
    throw new Error('VAPID 공개키 형식이 올바르지 않습니다.');
  }

  // 클릭 제스처가 살아 있을 때 권한을 먼저 요청한다.
  const permission =
    Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? '알림 권한이 거부되었습니다. 브라우저 설정에서 알림을 허용해주세요.'
        : '알림 권한이 필요합니다.',
    );
  }

  const reg = await getPushRegistration(true);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await withTimeout(
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes as BufferSource,
      }),
      SUBSCRIBE_TIMEOUT_MS,
      '푸시 구독이 응답하지 않습니다. 앱을 완전히 종료한 뒤 다시 열어 시도해 주세요.',
    );
  }

  const payload = payloadFromSubscription(sub);
  if (!payload) throw new Error('구독 정보를 읽을 수 없습니다.');
  return payload;
}

/** 브라우저 구독 해제 + 서버 DB에서 endpoint 삭제 */
export async function unsubscribeFromWebPush(): Promise<void> {
  if (!isPushSupported()) return;
  const reg = await getPushRegistration(false);
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  const res = await fetchWithTimeout(
    '/api/push/subscribe',
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    },
    '구독 해제 요청이 시간 초과되었습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
  );
  const json = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || !json.success) throw new Error(json.error ?? '구독 해제 실패');

  await sub.unsubscribe();
}
