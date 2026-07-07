-- =========================================================
-- 2026-07-07
-- 코드 선발급자 "예약 등록"(member_id 미매핑 PENDING 계정 대응)
--
-- 목적:
--  - user_profiles.member_id 가 NULL(PENDING) 인 계정도 운영자가 먼저 특례/상위리더를 등록해둔다.
--  - 이후 member_id 가 매핑되면 pre_issued_code_member_settings 로 자동 승격(upsert)한다.
--  - 예약 상태는 정산/승급/오버라이드 계산에 직접 영향이 없어 안전하다.
-- =========================================================

CREATE TABLE IF NOT EXISTS pre_issued_code_pending_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  desired_parent_leader_member_id UUID NOT NULL REFERENCES public.organization_members(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  special_unit_price INTEGER NOT NULL DEFAULT 100000 CHECK (special_unit_price > 0),
  special_unit_limit INTEGER NOT NULL DEFAULT 10 CHECK (special_unit_limit > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE NULL,
  desired_status TEXT NOT NULL DEFAULT 'active' CHECK (desired_status IN ('active', 'paused', 'ended')),
  note TEXT NULL,

  promoted BOOLEAN NOT NULL DEFAULT FALSE,
  promoted_at TIMESTAMPTZ NULL,
  promoted_member_id UUID NULL,
  promoted_setting_id UUID NULL REFERENCES pre_issued_code_member_settings(id) ON DELETE SET NULL,
  last_promotion_error TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL,

  CONSTRAINT pre_issued_code_pending_settings_unique_profile UNIQUE (user_profile_id),
  CONSTRAINT pre_issued_code_pending_settings_effective_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_pending_settings_promoted
  ON pre_issued_code_pending_settings(promoted, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_pending_settings_parent
  ON pre_issued_code_pending_settings(desired_parent_leader_member_id);

CREATE TABLE IF NOT EXISTS pre_issued_code_pending_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pending_setting_id UUID NOT NULL REFERENCES pre_issued_code_pending_settings(id) ON DELETE CASCADE,
  user_profile_id UUID NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID NULL,
  change_reason TEXT NOT NULL,
  before_json JSONB NULL,
  after_json JSONB NULL
);

CREATE INDEX IF NOT EXISTS idx_pre_issued_code_pending_settings_audit_pending
  ON pre_issued_code_pending_settings_audit(pending_setting_id, changed_at DESC);

