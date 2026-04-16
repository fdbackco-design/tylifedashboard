-- =========================================================
-- Prevent duplicate auto-created sales members by name
-- 2026-04-16
-- =========================================================

/**
 * 동기화가 병렬로 돌면서 external_id가 없는 organization_members가
 * 같은 name으로 중복 생성되는 문제 방지.
 *
 * - external_id IS NULL 인 row는 "자동 생성/임시" 성격이므로 name 중복을 금지한다.
 * - customer 노드는 external_id = 'customer:{uuid}' 이므로 대상에서 제외된다.
 */

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_members_name_when_no_external
  ON organization_members (name)
  WHERE external_id IS NULL;

