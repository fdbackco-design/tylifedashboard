-- =========================================================
-- contracts.group_bonus_join_date
-- 2026-07-06
--
-- 2026-06 조기가동(그룹) 보너스 전용 가입일 override.
-- - TY 동기화 payload 에 포함되지 않아 join_date 는 TY 원본을 유지한다.
-- - 정산 재계산 시 group-bonus.ts 가 이 값을 우선 사용한다.
-- =========================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS group_bonus_join_date date;

COMMENT ON COLUMN public.contracts.group_bonus_join_date IS
  '조기가동 그룹 보너스(2026-06) 가입일 윈도우 판정 전용. NULL이면 join_date 사용. TY 동기화는 덮어쓰지 않음.';

COMMENT ON COLUMN public.settlement_statement_overrides.bonus_amount IS
  '성과 장려금/보너스, 원. NOT NULL이면 정산 재계산 시 monthly_settlements.incentive_amount 로 반영(명세서 표시에도 사용).';
