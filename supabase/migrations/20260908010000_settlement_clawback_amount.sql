-- =========================================================
-- settlement_statement_overrides.clawback_amount
-- 2026-09-08
--
-- 정산월·영업자별 수동 환수금(원). 양수 = 합계에서 차감할 금액.
-- NULL = 미입력(코드에 고정된 예외 환수가 있으면 그 값을 사용).
-- 0 = 환수 없음(코드 예외 환수도 적용하지 않음).
-- =========================================================

ALTER TABLE public.settlement_statement_overrides
  ADD COLUMN IF NOT EXISTS clawback_amount integer;

COMMENT ON COLUMN public.settlement_statement_overrides.clawback_amount
  IS '수동 환수금, 원 (NULL = 미입력, 0 = 환수 없음). 합계에서 차감한다.';
