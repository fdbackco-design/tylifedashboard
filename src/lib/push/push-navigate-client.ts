/** Service Worker ↔ 페이지 공통 키 (BroadcastChannel + postMessage) */
export const PUSH_NAV_CHANNEL = 'tylife-push-navigate';
export const PUSH_NAV_MSG_TYPE = 'PUSH_NOTIFICATION_NAVIGATE';
export const PUSH_NAV_PENDING_KEY = 'tylife_pending_push_nav';

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

export function drainPendingPushNavigation(): void {
  if (typeof window === 'undefined') return;
  const pending = sessionStorage.getItem(PUSH_NAV_PENDING_KEY);
  if (!pending) return;
  applyPushNavigation(pending);
}
