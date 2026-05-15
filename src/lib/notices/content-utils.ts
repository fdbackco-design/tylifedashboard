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

/** 관리자 미디어 URL → 영업자용 API URL */
export function rewriteNoticeContentForMember(html: string, noticeId: string): string {
  if (!html) return '';
  return html.replace(
    /\/api\/admin\/notices\/([^/"']+)\/media\?path=([^"'&\s]+)/g,
    (_, id, encodedPath) => `/api/notices/${id}/media?path=${encodedPath}`,
  );
}
