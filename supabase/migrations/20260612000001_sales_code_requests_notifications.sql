-- =========================================================
-- sales_code_requests : 앱 알림 발송 timestamp 컬럼
-- 2026-06-12
--
-- 영업자 코드 발급 신청 상태 변화(반려/완료)에 따라 신청자에게 push 알림을
-- 보낼 때, 동일 신청에 중복 발송하지 않기 위해 발송 시각을 기록한다.
--
--   rejected_notified_at  : status='반려' 가 되어 반려 push 를 1회 보낸 시각
--   completed_notified_at : 같은 이름/전화번호의 계정이 실제 발급되어 완료 push 를
--                           1회 보낸 시각. 발송과 동시에 status='처리완료' 로 전이.
--
-- 기존 status CHECK constraint('신청중','시트등록완료','처리완료','반려') 는
-- 그대로 사용한다 (사용자 화면 레이블만 '처리중' 으로 표시).
-- =========================================================

ALTER TABLE public.sales_code_requests
  ADD COLUMN IF NOT EXISTS rejected_notified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_notified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_code_requests_rejected_notified_at
  ON public.sales_code_requests (rejected_notified_at)
  WHERE rejected_notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_code_requests_completed_notified_at
  ON public.sales_code_requests (completed_notified_at)
  WHERE completed_notified_at IS NULL;

COMMENT ON COLUMN public.sales_code_requests.rejected_notified_at
  IS '반려 알림(push) 발송 시각. NULL 이면 미발송. 동일 반려 알림 중복 발송 방지에 사용.';
COMMENT ON COLUMN public.sales_code_requests.completed_notified_at
  IS '계정 발급 완료 알림(push) 발송 시각. NULL 이면 미발송. 발송과 동시에 status=''처리완료'' 로 전이.';
