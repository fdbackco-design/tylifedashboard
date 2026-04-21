/**
 * 대시보드 표시 전용: DB 이름·상위 조직 라벨 정리 (집계 id/로직은 변경하지 않음)
 */

/** organization_members.name의 "[고객] 홍길동" → "홍길동" */
export function stripCustomerMemberNamePrefix(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  if (!raw) return '';
  const stripped = raw.replace(/^\[고객\]\s*/i, '').trim();
  return stripped.length > 0 ? stripped : raw;
}

/**
 * 상위 조직 컬럼: 본사(안성준) 직속은 라벨을 "안성준"으로 통일.
 * - parent가 HQ 멤버 id이거나, 부모 표시명이 안성준이면 "안성준"
 * - 그 외 부모명은 고객 접두어 제거 후 표시
 */
export function formatDashboardParentLabel(
  parentId: string | null | undefined,
  rawParentName: string,
  hqMemberId: string | null,
): string {
  if (rawParentName === '-' || !parentId) return rawParentName;
  if (hqMemberId && parentId === hqMemberId) return '안성준';
  const base = stripCustomerMemberNamePrefix(rawParentName);
  if (base === '안성준') return '안성준';
  return base.length > 0 ? base : rawParentName;
}
