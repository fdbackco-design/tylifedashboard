-- =========================================================
-- contracts: 정산 이월 / 정산 상태 추적용 컬럼 추가
-- 2026-06-09
--
-- 배경
--   - 정산 기준이 "계약 상태=가입" 에서 "해피콜 결과(성공/완료/계약변경) + 송장번호 30일 존재"
--     기준으로 확장된다. 송장번호 30일 기준을 충족하지 못한 계약은 다음 정산월로 이월된다.
--   - 본 마이그레이션은 이월 흐름을 DB에서 추적할 수 있도록 컬럼만 추가한다.
--   - 정산 계산 로직 변경은 코드(monthly-calculate.ts 등) 측에서 수행한다.
--
-- 신규 컬럼 의미
--   settlement_deferred    : true 이면 본 계약이 정산월에 자동/수동 이월된 적이 있음
--   deferred_from_month    : 이월 전(원래 정산되었어야 할) 정산월 (YYYY-MM)
--   deferred_to_month      : 이월 대상 정산월 (YYYY-MM) — 정산은 이 월에서 다시 평가됨
--   deferred_reason        : 이월 사유 (예: invoice_missing / manual_override 등 자유 문자열)
--   settlement_status      : 마지막 평가 결과 — ELIGIBLE_CONFIRMED / DEFERRED_TO_NEXT_MONTH / EXCLUDED_CANCELLED
--
-- 운영 가이드 (수동 예외)
--   - 5월 정산에서 제외 + 6월 정산으로 이월 처리를 수동으로 하려면 아래처럼 직접 UPDATE 한다.
--       UPDATE public.contracts
--       SET    settlement_deferred = true,
--              deferred_from_month = '2026-05',
--              deferred_to_month   = '2026-06',
--              deferred_reason     = 'manual_override: 6월 배송 확인',
--              settlement_status   = 'DEFERRED_TO_NEXT_MONTH'
--       WHERE  id IN ('<uuid-1>', '<uuid-2>');
--   - 다음 월(6월) 정산 재계산 시 자동으로 본 계약을 후보로 잡고 invoice/해피콜 조건을 재평가한다.
-- =========================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS settlement_deferred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deferred_from_month text,
  ADD COLUMN IF NOT EXISTS deferred_to_month   text,
  ADD COLUMN IF NOT EXISTS deferred_reason     text,
  ADD COLUMN IF NOT EXISTS settlement_status   text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_settlement_status_check'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_settlement_status_check
      CHECK (
        settlement_status IS NULL
        OR settlement_status IN ('ELIGIBLE_CONFIRMED', 'DEFERRED_TO_NEXT_MONTH', 'EXCLUDED_CANCELLED')
      );
  END IF;

  -- YYYY-MM 포맷 가벼운 검증 (NULL 허용)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_deferred_from_month_fmt_check'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_deferred_from_month_fmt_check
      CHECK (deferred_from_month IS NULL OR deferred_from_month ~ '^[0-9]{4}-[0-9]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contracts_deferred_to_month_fmt_check'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_deferred_to_month_fmt_check
      CHECK (deferred_to_month IS NULL OR deferred_to_month ~ '^[0-9]{4}-[0-9]{2}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_settlement_status
  ON public.contracts (settlement_status);

CREATE INDEX IF NOT EXISTS idx_contracts_deferred_to_month
  ON public.contracts (deferred_to_month)
  WHERE settlement_deferred = true;
