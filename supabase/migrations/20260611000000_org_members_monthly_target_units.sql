-- =========================================================
-- organization_members.monthly_target_units
-- 2026-06-11
--
-- 영업자별 "이번 달 목표 구좌" 저장 컬럼.
--   - 본인(/organization 페이지)이 직접 수정 가능
--   - 관리자(/admin/organization)는 조직 전원 목표/달성률 확인
--
-- 정책
--   - 컬럼은 NULL 허용. NULL 일 때는 코드에서 20으로 폴백한다.
--     (DEFAULT 를 20으로 박지 않는 이유: 정산/조직도 집계 로직은 본 컬럼을 절대 참조하지 않으며,
--      추후 기본값을 바꿔야 할 때 데이터를 일괄 덮어쓸 위험을 피하기 위함)
--   - 양의 정수만 허용.
-- =========================================================

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS monthly_target_units integer;

ALTER TABLE public.organization_members
  DROP CONSTRAINT IF EXISTS organization_members_monthly_target_units_positive;

ALTER TABLE public.organization_members
  ADD CONSTRAINT organization_members_monthly_target_units_positive
  CHECK (monthly_target_units IS NULL OR monthly_target_units > 0);

COMMENT ON COLUMN public.organization_members.monthly_target_units IS
  '영업자별 이번 달 목표 구좌(>0). NULL 이면 화면에서 20 으로 폴백한다. 정산/집계 로직은 절대 참조하지 않는다.';
