import webpush from 'web-push';

export function assertVapidConfigured(): void {
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()) {
    throw new Error('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set');
  }
  if (!process.env.VAPID_PRIVATE_KEY?.trim()) {
    throw new Error('VAPID_PRIVATE_KEY is not set');
  }
  if (!process.env.VAPID_SUBJECT?.trim()) {
    throw new Error('VAPID_SUBJECT is not set');
  }
}

export function configureWebPush(): void {
  assertVapidConfigured();
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export function getVapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? '';
}
