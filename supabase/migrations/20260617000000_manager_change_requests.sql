-- =========================================================
-- manager_change_requests
-- 2026-06-17
--
-- 영업자가 산하 계약의 담당자 변경을 신청하고, 관리자가 완료 처리하는 테이블.
--   - 영업자 페이지: /organization/manager-change
--   - 관리자 페이지: /admin/manager-change
--
-- 본 마이그레이션은 신규 테이블 추가만 한다.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.manager_change_requests (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  requester_user_id       uuid        NOT NULL,
  requester_member_id     uuid        REFERENCES public.organization_members(id) ON DELETE SET NULL,
  requester_name          text        NOT NULL,
  requester_phone         text,

  contract_id             uuid        NOT NULL REFERENCES public.contracts(id) ON DELETE RESTRICT,
  customer_id             uuid        NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,

  customer_name           text        NOT NULL,
  resident_number         text        NOT NULL,
  customer_phone          text,
  account_count           integer     NOT NULL DEFAULT 1 CHECK (account_count > 0),
  contract_codes          text        NOT NULL,
  item_name               text        NOT NULL,

  branch_name             text        NOT NULL DEFAULT 'Feed Life',

  before_manager_name     text        NOT NULL,
  before_manager_phone    text,
  after_manager_name      text        NOT NULL,
  after_manager_phone     text        NOT NULL,

  status                  text        NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'COMPLETED')),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,
  completed_by_admin_id     uuid,

  admin_notified_at       timestamptz,
  completed_notified_at   timestamptz
);

-- 동일 신청자 + 동일 고객에 대해 PENDING 중복 신청 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_change_pending_per_customer
  ON public.manager_change_requests (requester_user_id, customer_id)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_manager_change_requests_status
  ON public.manager_change_requests (status);
CREATE INDEX IF NOT EXISTS idx_manager_change_requests_created_at
  ON public.manager_change_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_change_requests_requester_user
  ON public.manager_change_requests (requester_user_id);

CREATE INDEX IF NOT EXISTS idx_manager_change_requests_admin_notify_pending
  ON public.manager_change_requests (id)
  WHERE admin_notified_at IS NULL;

CREATE OR REPLACE FUNCTION public.tg_manager_change_requests_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manager_change_requests_updated_at ON public.manager_change_requests;
CREATE TRIGGER trg_manager_change_requests_updated_at
  BEFORE UPDATE ON public.manager_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_manager_change_requests_set_updated_at();

ALTER TABLE public.manager_change_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.manager_change_requests IS '영업자 담당자 변경 신청. 관리자 완료 처리 후 신청자에게 알림.';
COMMENT ON COLUMN public.manager_change_requests.status IS 'PENDING=신청중, COMPLETED=완료';
COMMENT ON COLUMN public.manager_change_requests.contract_codes IS '여러 contract_code 는 " / " 로 연결 저장';
COMMENT ON COLUMN public.manager_change_requests.before_manager_name IS '신청 영업자(변경 전 담당자) 이름';
COMMENT ON COLUMN public.manager_change_requests.admin_notified_at IS '관리자 푸시 알림 발송 시각';
COMMENT ON COLUMN public.manager_change_requests.completed_notified_at IS '신청자 완료 푸시 알림 발송 시각';
