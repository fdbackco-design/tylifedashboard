/** Service Worker ↔ 페이지 공통 키 (BroadcastChannel + postMessage) */
export const PUSH_NAV_CHANNEL = 'tylife-push-navigate';
export const PUSH_NAV_MSG_TYPE = 'PUSH_NOTIFICATION_NAVIGATE';
export const PUSH_NAV_PENDING_KEY = 'tylife_pending_push_nav';

const PUSH_NAV_CACHE = 'tylife-push-nav-v1';
const PUSH_NAV_CACHE_KEY = 'https://tylife.local/pending-push-nav';

export function normalizePushNavPath(url: string): string {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url);
      return u.pathname + u.search + u.hash;
    }
  } catch {
    /* ignore */
  }
  return url.startsWith('/') ? url : `/${url}`;
}

/** SW 메시지 수신 시 즉시 이동 (router.push 대신 full navigation) */
export function applyPushNavigation(url: string): void {
  if (typeof window === 'undefined') return;
  const path = normalizePushNavPath(url);
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (current === path) {
    sessionStorage.removeItem(PUSH_NAV_PENDING_KEY);
    return;
  }
  sessionStorage.setItem(PUSH_NAV_PENDING_KEY, path);
  window.location.assign(path);
}

async function readAndClearCachedPushNavigation(): Promise<string | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    const cache = await caches.open(PUSH_NAV_CACHE);
    const res = await cache.match(PUSH_NAV_CACHE_KEY);
    if (!res) return null;
    const path = (await res.text()).trim();
    await cache.delete(PUSH_NAV_CACHE_KEY);
    return path || null;
  } catch {
    return null;
  }
}

/** SW가 알림 탭 시 저장한 경로 + sessionStorage 대기 경로를 순서대로 처리 */
export async function drainPendingPushNavigation(): Promise<void> {
  if (typeof window === 'undefined') return;

  const pending = sessionStorage.getItem(PUSH_NAV_PENDING_KEY);
  if (pending) {
    applyPushNavigation(pending);
    return;
  }

  const cached = await readAndClearCachedPushNavigation();
  if (cached) applyPushNavigation(cached);
}
