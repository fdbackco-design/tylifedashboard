-- =========================================================
-- contracts: 송장번호 최초 등록 시점 추적용 컬럼 추가
-- 2026-06-10
--
-- 배경
--   - 정산 v2 에서 yearMonth 30일까지 송장번호가 존재했는지를 정확히 판정해야 한다.
--   - 기존 contracts 테이블에는 "현재 송장번호" 만 있고, 언제 처음 들어왔는지 시각 정보가 없다.
--   - 본 컬럼은 sync-service 가 신규 송장번호를 처음 발견한 시점을 자동 기록한다.
--   - 2026-05 정산은 데이터 부재로 예외 처리(현재 시점 존재 여부)되며, 2026-06 정산부터
--     본 컬럼 기준으로 30일까지(공휴일 보정 포함) 존재 여부를 판정한다.
--
-- NULL 의미
--   - 자동 기록 도입 이전부터 송장이 있던 계약은 NULL 일 수 있다.
--   - 정산 로직에서는 invoice_no 가 존재하면서 invoice_registered_at 가 NULL 이면
--     "기준일 이전부터 있던 송장" 으로 간주(=마감일 이내 충족)한다.
-- =========================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS invoice_registered_at timestamptz;

COMMENT ON COLUMN public.contracts.invoice_registered_at IS
  '송장번호가 처음 들어온 시점(sync-service 자동 기록). 정산 v2에서 yearMonth 30일까지 존재 여부 판정에 사용. NULL은 자동 기록 이전부터 있던 송장으로 간주.';

CREATE INDEX IF NOT EXISTS idx_contracts_invoice_registered_at
  ON public.contracts (invoice_registered_at);
