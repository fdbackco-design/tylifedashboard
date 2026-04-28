-- =========================================================
-- TY Life Dashboard - Settlement self-contract preference
-- 2026-04-28
-- =========================================================

/**
 * 정산 현황 UI에서 "본인 계약 수당 인정" 토글 상태를 월/라인 단위로 저장.
 *
 * - PK: (year_month, top_line_id)
 * - 기본값: included = true (인정)
 */

CREATE TABLE IF NOT EXISTS settlement_self_contract_preferences (
  year_month TEXT NOT NULL,
  top_line_id UUID NOT NULL,
  included BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year_month, top_line_id)
);

-- year_month 포맷 간단 검증(YYYY-MM). 기존 데이터가 없으므로 CHECK로 충분.
ALTER TABLE settlement_self_contract_preferences
  DROP CONSTRAINT IF EXISTS settlement_self_contract_preferences_year_month_format_chk;
ALTER TABLE settlement_self_contract_preferences
  ADD CONSTRAINT settlement_self_contract_preferences_year_month_format_chk
  CHECK (year_month ~ '^\d{4}-\d{2}$');

-- 조회 성능용 (월별)
CREATE INDEX IF NOT EXISTS idx_settlement_self_contract_preferences_year_month
  ON settlement_self_contract_preferences (year_month);

