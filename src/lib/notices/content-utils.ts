/** 본문 HTML → 목록용 요약 (태그 제거, 길이 제한) */
export function noticeContentSummary(html: string, maxLen = 100): string {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/**
 * 관리자(`/api/admin/notices/{id}/media`) 미디어 URL을 영업자/관리자 공용
 * `/api/notices/{id}/media`로 정규화한다.
 *
 * - 상대 경로(`/api/admin/...`)와 절대 URL(`https://host/api/admin/...`) 모두 매칭.
 * - 신규 데이터는 처음부터 공용 경로로 저장되어 매칭되지 않지만, 과거 데이터 호환을 위해 유지.
 * - `noticeId` 인자는 호환성 유지를 위해 받지만, 본문 안의 실제 ID를 그대로 사용한다.
 */
export function rewriteNoticeContentForMember(html: string, _noticeId: string): string {
  if (!html) return '';
  return html.replace(
    /\/api\/admin\/notices\/([^/"'\s]+)\/media\?path=([^"'\s<>]+)/g,
    (_, id, encodedPath) => `/api/notices/${id}/media?path=${encodedPath}`,
  );
}
