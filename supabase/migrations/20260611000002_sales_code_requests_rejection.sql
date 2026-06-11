-- =========================================================
-- sales_code_requests : 반려 사유 / 처리자 / 처리시각
-- 2026-06-11
--
-- /admin/newcode 에서 신청 항목을 사유를 입력하여 반려할 수 있도록
-- 메타 컬럼을 추가한다. 기존 컬럼/제약조건은 수정하지 않는다.
-- =========================================================

ALTER TABLE public.sales_code_requests
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at      timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by      text;

COMMENT ON COLUMN public.sales_code_requests.rejection_reason IS '반려 사유 (status=반려 인 경우 사용)';
COMMENT ON COLUMN public.sales_code_requests.rejected_at      IS '반려 처리 시각';
COMMENT ON COLUMN public.sales_code_requests.rejected_by      IS '반려 처리자 식별자(예: admin)';
