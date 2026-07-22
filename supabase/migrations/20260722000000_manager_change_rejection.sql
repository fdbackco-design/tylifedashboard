-- =========================================================
-- manager_change_requests : 반려(REJECTED) 상태 + 반려 컬럼
-- 2026-07-22
--
-- 관리자가 담당자 변경 신청을 반려할 수 있게 한다.
-- 영업자 코드 발급 신청(sales_code_requests)의 반려 동작과 동일한 형태:
--   status = 'REJECTED'
--   rejection_reason     : 반려 사유 (신청자 화면에 그대로 표시)
--   rejected_at          : 반려 처리 시각
--   rejected_by_admin_id : 반려 처리한 관리자 user id
--   rejected_notified_at : 반려 push 알림 1회 발송 시각 (중복 발송 방지)
--
-- 기존 PENDING 중복 방지 partial unique index 들은 WHERE status='PENDING'
-- 조건이므로, 반려된 신청은 재신청을 막지 않는다(코드 발급 반려와 동일).
-- =========================================================

ALTER TABLE public.manager_change_requests
  DROP CONSTRAINT IF EXISTS manager_change_requests_status_check;

ALTER TABLE public.manager_change_requests
  ADD CONSTRAINT manager_change_requests_status_check
  CHECK (status IN ('PENDING', 'RECEIVED', 'COMPLETED', 'REJECTED'));

ALTER TABLE public.manager_change_requests
  ADD COLUMN IF NOT EXISTS rejection_reason     text,
  ADD COLUMN IF NOT EXISTS rejected_at          timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by_admin_id uuid,
  ADD COLUMN IF NOT EXISTS rejected_notified_at timestamptz;

COMMENT ON COLUMN public.manager_change_requests.status
  IS 'PENDING=신청중, RECEIVED=접수완료(관리자 확인), COMPLETED=완료(동기화 반영), REJECTED=반려';
COMMENT ON COLUMN public.manager_change_requests.rejection_reason
  IS '반려 사유 (status=REJECTED 인 경우 사용, 신청자 화면에 표시)';
COMMENT ON COLUMN public.manager_change_requests.rejected_at
  IS '반려 처리 시각';
COMMENT ON COLUMN public.manager_change_requests.rejected_by_admin_id
  IS '반려 처리한 관리자 user id';
COMMENT ON COLUMN public.manager_change_requests.rejected_notified_at
  IS '반려 알림(push) 발송 시각. NULL 이면 미발송. 동일 반려 알림 중복 발송 방지.';
