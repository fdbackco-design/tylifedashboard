-- =========================================================
-- 2026-07-07
-- 코드 선발급자 설정 (개인 직접판매 특례 단가 + 예외 상위리더 연결)
-- - 기존 조직도/정산/승급 로직과 분리된 전용 설정 테이블
-- - member_id 1:1 설정 (활성/중지/종료 등 상태는 status로 관리)
-- =========================================================

CREATE TABLE IF NOT EXISTS pre_issued_code_member_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL UNIQUE REFERENCES organization_members(id) ON DELETE CASCADE,
  parent_leader_member_id UUID NOT NULL REFERENCES organization_members(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  special_unit_price INTEGER NOT NULL DEFAULT 100000 CHECK (special_unit_price >= 0),
  special_unit_limit INTEGER NOT NULL DEFAULT 10 CHECK (special_unit_limit >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL,
  CONSTRAINT pre_issued_code_member_settings_no_self_parent
    CHECK (member_id <> parent_leader_member_id),
  CONSTRAINT pre_issued_code_member_settings_effective_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_member_settings_parent
  ON pre_issued_code_member_settings(parent_leader_member_id);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_member_settings_status
  ON pre_issued_code_member_settings(status);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_member_settings_effective_from
  ON pre_issued_code_member_settings(effective_from);

-- 변경 이력(감사)
CREATE TABLE IF NOT EXISTS pre_issued_code_member_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id UUID NOT NULL REFERENCES pre_issued_code_member_settings(id) ON DELETE CASCADE,
  member_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID NULL,
  change_reason TEXT NOT NULL,
  before_json JSONB NULL,
  after_json JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_member_settings_audit_setting
  ON pre_issued_code_member_settings_audit(setting_id, changed_at DESC);

