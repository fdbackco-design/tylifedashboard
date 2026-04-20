-- =========================================================
-- Leader promotion events (store previous leader parent)
-- 2026-04-20
-- =========================================================

/**
 * 정책 승격(산하 가입 누적 20구좌) 시점에,
 * 승격자의 "이전 상위(리더)"를 저장해 재계산 시에도 승격 전 귀속을 안정적으로 재현한다.
 *
 * NOTE:
 * - organization_edges는 시점 이력이 없어서 승격 후 본사 직속으로 재배치하면
 *   재계산 때 "승격 전에는 누구 밑이었는지"를 잃는다.
 * - 이 테이블은 그 정보를 보존하기 위한 용도다.
 */

CREATE TABLE IF NOT EXISTS leader_promotion_events (
  member_id                UUID PRIMARY KEY REFERENCES organization_members (id) ON DELETE CASCADE,
  previous_parent_id       UUID REFERENCES organization_members (id) ON DELETE SET NULL,
  threshold_contract_id    UUID REFERENCES contracts (id) ON DELETE SET NULL,
  threshold_join_date      DATE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leader_promo_prev_parent ON leader_promotion_events (previous_parent_id);

CREATE OR REPLACE FUNCTION set_updated_at_leader_promotion_events()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_leader_promotion_events ON leader_promotion_events;
CREATE TRIGGER set_updated_at_leader_promotion_events
  BEFORE UPDATE ON leader_promotion_events
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at_leader_promotion_events();

