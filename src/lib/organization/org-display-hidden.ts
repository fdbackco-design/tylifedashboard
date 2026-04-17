/**
 * 조직도 UI / 정산현황에서 특정 고객 노드를 표시하지 않을 때 사용.
 * DB의 organization_members.name이 "[고객] 홍길동" 형태일 수 있으므로 접두어 제거 후 비교한다.
 */
const HIDDEN_NORMALIZED_NAMES = new Set(['송해민', '정성현', '손성훈']);

export function isOrgDisplayHiddenMemberName(rawName: string | null | undefined): boolean {
  const n = (rawName ?? '').replace(/^\[고객\]\s*/, '').trim();
  return HIDDEN_NORMALIZED_NAMES.has(n);
}
