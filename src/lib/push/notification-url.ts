/** 푸시 알림 탭 시 이동할 공지 상세 경로 */
export function noticeDetailPath(noticeId: string): string {
  return `/organization/notice/${noticeId}`;
}

/**
 * Service Worker openWindow·알림 data용 URL.
 * NEXT_PUBLIC_APP_URL이 있으면 절대 URL(Android TWA·PWA에 유리), 없으면 경로만.
 */
export function resolvePushNotificationUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}${normalized}` : normalized;
}
