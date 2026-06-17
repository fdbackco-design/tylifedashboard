-- 담당자 변경 신청: 동일 고객·연락처·가입일·담당자·상품 그룹 단위 중복 방지

ALTER TABLE public.manager_change_requests
  ADD COLUMN IF NOT EXISTS join_date date,
  ADD COLUMN IF NOT EXISTS selection_group_key text;

COMMENT ON COLUMN public.manager_change_requests.join_date IS '신청 대상 계약 그룹의 가입일(동일 그룹 기준)';
COMMENT ON COLUMN public.manager_change_requests.selection_group_key IS '고객·연락처·가입일·담당자·상품명이 동일한 계약 묶음 식별자';

DROP INDEX IF EXISTS idx_manager_change_pending_per_customer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_change_pending_per_group
  ON public.manager_change_requests (requester_user_id, selection_group_key)
  WHERE status = 'PENDING' AND selection_group_key IS NOT NULL AND selection_group_key <> '';
