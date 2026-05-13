import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Admin 로그인' };

export default async function AdminLoginPage() {
  redirect('/login?redirect=/admin');
}

