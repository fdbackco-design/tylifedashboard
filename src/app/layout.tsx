import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TY Life Dashboard',
  description: 'TY Life 계약 및 정산 관리 시스템',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
