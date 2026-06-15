-- ─────────────────────────────────────────────────────────
-- 관리자 알림 중복 발송 방지를 위한 timestamp 컬럼 추가
--
--  - sync_runs.admin_notified_at         : TY 동기화 신규 계약 알림 발송 시각
--  - sales_code_requests.admin_notified_at: 영업자 코드 발급 신청 알림 발송 시각
--
-- 두 컬럼 모두 NULL = "아직 발송하지 않음". 알림 발송이 한 건이라도 성공한
-- 직후에만 NOW() 로 마킹한다 (송신 실패 시엔 NULL 로 두어 다음 실행 시 재시도 가능).
-- ─────────────────────────────────────────────────────────

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS admin_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN sync_runs.admin_notified_at IS
  '관리자에게 신규 계약 알림을 발송한 시각. NULL 이면 아직 미발송 또는 재시도 가능 상태.';

ALTER TABLE sales_code_requests
  ADD COLUMN IF NOT EXISTS admin_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN sales_code_requests.admin_notified_at IS
  '관리자에게 영업자 코드 발급 신청 알림을 발송한 시각. NULL 이면 미발송.';

-- 발송 대기 큐를 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_sync_runs_admin_notify_pending
  ON sync_runs (id)
  WHERE admin_notified_at IS NULL AND status = 'completed' AND total_created > 0;

CREATE INDEX IF NOT EXISTS idx_sales_code_requests_admin_notify_pending
  ON sales_code_requests (id)
  WHERE admin_notified_at IS NULL;
