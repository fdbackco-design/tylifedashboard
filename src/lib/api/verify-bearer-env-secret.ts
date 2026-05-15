import type { NextRequest } from 'next/server';

/** Authorization: Bearer 토큰을 env 시크릿과 타이밍 안전하게 비교 */
export function verifyBearerMatchesEnvSecret(req: NextRequest, secret: string | undefined): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  if (!secret) return false;

  const token = authHeader.slice(7);
  const encoder = new TextEncoder();
  const tokenBytes = encoder.encode(token);
  const secretBytes = encoder.encode(secret);

  if (tokenBytes.length !== secretBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < tokenBytes.length; i++) {
    diff |= tokenBytes[i] ^ secretBytes[i];
  }
  return diff === 0;
}
