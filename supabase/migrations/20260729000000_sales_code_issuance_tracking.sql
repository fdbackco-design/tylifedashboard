-- 영업자 코드 발급의 엑셀/Google Sheets/계정 동기화 진행 상태 추적

ALTER TABLE public.sales_code_requests
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS issuance_status text NOT NULL DEFAULT 'WAITING',
  ADD COLUMN IF NOT EXISTS excel_downloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS processed_by_name text,
  ADD COLUMN IF NOT EXISTS sheet_row_number integer,
  ADD COLUMN IF NOT EXISTS sheet_written_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS issuance_error text,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_code_requests_issuance_status_check'
      AND conrelid = 'public.sales_code_requests'::regclass
  ) THEN
    ALTER TABLE public.sales_code_requests
      ADD CONSTRAINT sales_code_requests_issuance_status_check
      CHECK (
        issuance_status IN (
          'WAITING',
          'EXPORTED',
          'PROCESSING',
          'COMPLETED',
          'FAILED',
          'SYNC_FAILED'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_code_requests_sheet_row_positive'
      AND conrelid = 'public.sales_code_requests'::regclass
  ) THEN
    ALTER TABLE public.sales_code_requests
      ADD CONSTRAINT sales_code_requests_sheet_row_positive
      CHECK (sheet_row_number IS NULL OR sheet_row_number > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_code_requests_retry_count_nonnegative'
      AND conrelid = 'public.sales_code_requests'::regclass
  ) THEN
    ALTER TABLE public.sales_code_requests
      ADD CONSTRAINT sales_code_requests_retry_count_nonnegative
      CHECK (retry_count >= 0);
  END IF;
END $$;

UPDATE public.sales_code_requests
SET issuance_status = CASE
  WHEN status = '처리완료' THEN 'COMPLETED'
  WHEN synced_to_sheet THEN 'EXPORTED'
  ELSE 'WAITING'
END
WHERE issuance_status = 'WAITING';

CREATE INDEX IF NOT EXISTS idx_sales_code_requests_issuance_status
  ON public.sales_code_requests (issuance_status, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_code_requests_employee_id
  ON public.sales_code_requests (employee_id)
  WHERE employee_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_code_requests_sheet_row
  ON public.sales_code_requests (sheet_row_number)
  WHERE sheet_row_number IS NOT NULL;

COMMENT ON COLUMN public.sales_code_requests.issuance_status IS
  '관리자 발급 진행 상태: WAITING/EXPORTED/PROCESSING/COMPLETED/FAILED/SYNC_FAILED';
COMMENT ON COLUMN public.sales_code_requests.employee_id IS
  'fed + 휴대폰번호 뒤 8자리 형식의 사원ID';
COMMENT ON COLUMN public.sales_code_requests.sheet_row_number IS
  'ACCOUNT_ISSUE_SHEET_ID 시트에 기록된 실제 행 번호';

-- Google Sheets에는 원자적 append/row lock이 없으므로 발급 배치를 전역 직렬화한다.
CREATE TABLE IF NOT EXISTS public.sales_code_issuance_locks (
  lock_key text PRIMARY KEY,
  owner_token uuid NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_code_issuance_locks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.sales_code_issuance_locks IS
  '서로 다른 관리자 발급 요청이 동일 Google Sheets 빈 행을 덮어쓰지 않도록 하는 service_role 전용 잠금';
