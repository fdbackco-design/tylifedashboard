import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 서버 전용 환경변수 - 클라이언트 번들에 포함되지 않음
  serverExternalPackages: ['node-html-parser'],
  experimental: {
    // TODO: Server Actions 안정화 후 필요시 설정 추가
  },
};

export default nextConfig;
