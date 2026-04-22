-- =========================================================
-- Manual override for organization_edges
-- 2026-04-22
-- =========================================================
--
-- 목적:
-- - 조직도 UI에서 사용자가 수동으로 parent를 변경한 경우,
--   동기화(sync-service)가 해당 관계를 다시 덮어쓰지 않도록 "수동 잠금" 플래그를 둔다.
--

ALTER TABLE organization_edges
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false;

ALTER TABLE organization_edges
  ADD COLUMN IF NOT EXISTS manual_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_org_edges_is_manual ON organization_edges (is_manual);

