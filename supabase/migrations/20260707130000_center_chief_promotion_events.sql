-- =========================================================
-- Center chief promotion events (산하 리더 5명 달성)
-- 2026-07-07
-- =========================================================

/**
 * 센터장 달성(산하 리더 5명) 시점에 5번째 리더·이전 상위를 저장해
 * 재계산 시에도 센터장 달성 이후 롤업 단가(구좌당 20만) 경계를 안정적으로 재현한다.
 */

CREATE TABLE IF NOT EXISTS center_chief_promotion_events (
  member_id                    UUID PRIMARY KEY REFERENCES organization_members (id) ON DELETE CASCADE,
  previous_parent_id           UUID REFERENCES organization_members (id) ON DELETE SET NULL,
  threshold_leader_member_id   UUID REFERENCES organization_members (id) ON DELETE SET NULL,
  threshold_contract_id        UUID REFERENCES contracts (id) ON DELETE SET NULL,
  threshold_join_date            DATE,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_center_chief_promo_prev_parent
  ON center_chief_promotion_events (previous_parent_id);

CREATE INDEX IF NOT EXISTS idx_center_chief_promo_threshold_leader
  ON center_chief_promotion_events (threshold_leader_member_id);

CREATE OR REPLACE FUNCTION set_updated_at_center_chief_promotion_events()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_center_chief_promotion_events ON center_chief_promotion_events;
CREATE TRIGGER set_updated_at_center_chief_promotion_events
  BEFORE UPDATE ON center_chief_promotion_events
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_center_chief_promotion_events();
