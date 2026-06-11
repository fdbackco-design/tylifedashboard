/**
 * organization_members.name 가 다음과 같은 형태로 깨져 있는 경우를 방어한다.
 *   - JSON 직렬화된 row 가 통째로 들어간 케이스 (예: '{"idx":0,"name":"임혜진",...}')
 *   - 객체가 그대로 전달된 케이스
 *
 * 항상 사람이 읽을 수 있는 "이름 문자열"을 반환한다. 추출에 실패하면 원본을 그대로 반환한다.
 *
 * 주의:
 *   - `[고객] ` 같은 prefix 처리는 호출자에서 별도로 한다(기존 동작 유지).
 *   - 이 helper 는 데이터 표시 방어용이며, 데이터 원본을 수정하지 않는다.
 */
export function extractMemberName(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'object') {
    const v = (raw as { name?: unknown }).name;
    return typeof v === 'string' ? v : '';
  }
  const s = String(raw);
  if (!s.startsWith('{')) return s;
  if (!s.includes('"name"')) return s;

  // 1차: JSON parse 시도
  try {
    const obj = JSON.parse(s) as { name?: unknown };
    if (obj && typeof obj.name === 'string') return obj.name;
  } catch {
    /* ignore, fall through */
  }
  // 2차: regex 로 "name":"..." 추출 (이스케이프된 따옴표는 보존)
  const m = s.match(/"name"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) return m[1].replace(/\\(.)/g, '$1');
  return s;
}
