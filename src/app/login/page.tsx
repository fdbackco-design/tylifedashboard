import type { Metadata } from 'next';
import LoginClient from './LoginClient';

export const metadata: Metadata = { title: '로그인' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const redirect = sp.redirect ?? '/organization';
  return <LoginClient redirect={redirect} />;
}

