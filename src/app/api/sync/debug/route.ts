/**
 * GET /api/sync/debug
 * TY Life API 응답 구조 확인용. 프로덕션 배포 후 삭제 권장.
 *
 * 반환:
 *   - raw_response_keys  : 응답 최상위 키 목록
 *   - data_keys          : data 객체 키 목록
 *   - listHtml_length    : listHtml 문자열 길이
 *   - listHtml_preview   : listHtml 앞 500자
 *   - parsed_count       : 파싱된 항목 수
 *   - parsed_first       : 첫 번째 파싱 결과
 *   - raw_response       : 전체 응답 (listHtml 제외)
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchContractList } from '@/lib/tylife/client';
import { parseContractListHtml } from '@/lib/tylife/html-parser';

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  const secret = process.env.SYNC_API_SECRET;
  if (!secret) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(secret);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await fetchContractList(1, 10);

    // listHtml 분리 (크기가 클 수 있으므로)
    const { listHtml, ...dataWithoutHtml } =
      (raw.data as { listHtml?: string } & Record<string, unknown>) ?? {};

    const htmlStr = listHtml ?? '';
    const parsed = parseContractListHtml(htmlStr);

    return NextResponse.json({
      // 응답 구조 확인
      raw_response_keys: Object.keys(raw),
      data_keys: Object.keys(raw.data ?? {}),

      // listHtml 확인
      listHtml_length: htmlStr.length,
      listHtml_preview: htmlStr.slice(0, 500),

      // 파싱 결과 확인
      parsed_count: parsed.length,
      parsed_first: parsed[0] ?? null,

      // data 나머지 필드
      data_without_html: dataWithoutHtml,

      // raw 최상위 (data 제외)
      raw_without_data: Object.fromEntries(
        Object.entries(raw).filter(([k]) => k !== 'data'),
      ),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
