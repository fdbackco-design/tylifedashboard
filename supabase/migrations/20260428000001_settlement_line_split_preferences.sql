-- =========================================================
-- TY Life Dashboard - Settlement line split preference
-- 2026-04-28
-- =========================================================

/**
 * 정산 현황 UI에서 "산하 분리 보기" 상태를 월/라인 단위로 저장.
 *
 * - PK: (year_month, top_line_id)
 * - 기본값: is_split = false (기본 보기)
 */

CREATE TABLE IF NOT EXISTS settlement_line_split_preferences (
  year_month TEXT NOT NULL,
  top_line_id UUID NOT NULL,
  is_split BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year_month, top_line_id)
);

ALTER TABLE settlement_line_split_preferences
  DROP CONSTRAINT IF EXISTS settlement_line_split_preferences_year_month_format_chk;
ALTER TABLE settlement_line_split_preferences
  ADD CONSTRAINT settlement_line_split_preferences_year_month_format_chk
  CHECK (year_month ~ '^\d{4}-\d{2}$');

CREATE INDEX IF NOT EXISTS idx_settlement_line_split_preferences_year_month
  ON settlement_line_split_preferences (year_month);

