import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

const withPWA = withPWAInit({
  dest: 'public',
  customWorkerSrc: 'worker',
  disable: process.env.NODE_ENV === 'development',
  // 관리자 세션 쿠키가 필요한 API는 캐시하면 401이 고정되는 문제가 생긴다(Workbox 기본 apis 규칙).
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith('/api/admin'),
        handler: 'NetworkOnly',
        method: 'GET',
      },
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith('/api/admin'),
        handler: 'NetworkOnly',
        method: 'POST',
      },
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith('/api/admin'),
        handler: 'NetworkOnly',
        method: 'PUT',
      },
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith('/api/push'),
        handler: 'NetworkOnly',
        method: 'GET',
      },
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith('/api/push'),
        handler: 'NetworkOnly',
        method: 'POST',
      },
      {
        urlPattern: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
          sameOrigin && url.pathname.startsWith('/api/push'),
        handler: 'NetworkOnly',
        method: 'DELETE',
      },
    ],
  },
});

const nextConfig: NextConfig = {
  // 서버 전용 환경변수 - 클라이언트 번들에 포함되지 않음
  serverExternalPackages: ['node-html-parser'],
  experimental: {
    // TODO: Server Actions 안정화 후 필요시 설정 추가
  },
};

export default withPWA(nextConfig);
