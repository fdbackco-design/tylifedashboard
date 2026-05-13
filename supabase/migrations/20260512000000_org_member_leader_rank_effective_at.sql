-- 리더 직급이 실제로 적용되기 시작한 시각(수동 기록).
-- NULL이면 기존 산하 20구좌 threshold / contracts.created_at 보정만 사용한다.

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS leader_rank_effective_at TIMESTAMPTZ;

COMMENT ON COLUMN organization_members.leader_rank_effective_at IS
  'DB rank가 리더인 멤버에 대해, 리더 단가·KPI를 적용할 기준 시각(UTC). NULL이면 threshold 로직만 사용.';
