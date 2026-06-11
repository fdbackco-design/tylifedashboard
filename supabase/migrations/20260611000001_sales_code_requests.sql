-- =========================================================
-- sales_code_requests
-- 2026-06-11
--
-- 영업자가 자기 산하 영업자의 TY 코드 발급을 신청하는 테이블.
--   - 영업자 페이지: 본인 신청 작성/조회
--   - /admin/newcode: 관리자 조회 + 구글 시트 동기화
--   - 동기화 후 상태='시트등록완료', synced_to_sheet=true, sheet_synced_at=now()
--
-- 본 마이그레이션은 신규 테이블 추가만 한다. 기존 정산/조직도/TY 동기화 로직은 본 테이블을 절대 참조하지 않는다.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.sales_code_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 신청자(현재 로그인한 영업자) — Supabase Auth user.id 와 매핑된 organization_members.id
  applicant_user_id     uuid        NOT NULL,
  applicant_member_id   uuid        REFERENCES public.organization_members(id) ON DELETE SET NULL,
  applicant_name        text        NOT NULL,

  -- 신청 대상(=발급 대상 영업자) 정보
  name                  text        NOT NULL,
  -- YYYYMMDD 8자리 문자열로 저장 (예: '19990101')
  birth_date            text        NOT NULL,
  gender                text        NOT NULL CHECK (gender IN ('남', '여')),
  -- 표시용 포맷('010-1234-1234'), 추가 검색 편의를 위해 digits 도 별도 컬럼으로 저장
  phone                 text        NOT NULL,
  phone_digits          text        NOT NULL,
  has_own_contract      boolean     NOT NULL,
  memo                  text,

  status                text        NOT NULL DEFAULT '신청중'
    CHECK (status IN ('신청중', '시트등록완료', '처리완료', '반려')),

  requested_at          timestamptz NOT NULL DEFAULT now(),

  synced_to_sheet       boolean     NOT NULL DEFAULT false,
  sheet_synced_at       timestamptz,
  sheet_synced_by       text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_code_requests_applicant_user
  ON public.sales_code_requests (applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_sales_code_requests_applicant_member
  ON public.sales_code_requests (applicant_member_id);
CREATE INDEX IF NOT EXISTS idx_sales_code_requests_status
  ON public.sales_code_requests (status);
CREATE INDEX IF NOT EXISTS idx_sales_code_requests_requested_at
  ON public.sales_code_requests (requested_at DESC);

CREATE OR REPLACE FUNCTION public.tg_sales_code_requests_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_code_requests_updated_at ON public.sales_code_requests;
CREATE TRIGGER trg_sales_code_requests_updated_at
  BEFORE UPDATE ON public.sales_code_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_sales_code_requests_set_updated_at();

-- RLS: service_role 만 접근 (server-side admin client 통해 모든 R/W 수행)
ALTER TABLE public.sales_code_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.sales_code_requests IS '영업자 코드 발급 신청. /admin/newcode 에서 구글 시트로 동기화한다.';
COMMENT ON COLUMN public.sales_code_requests.birth_date     IS 'YYYYMMDD 8자리 문자열';
COMMENT ON COLUMN public.sales_code_requests.phone          IS '표시용 포맷 (예: 010-1234-1234)';
COMMENT ON COLUMN public.sales_code_requests.phone_digits   IS '숫자만 추출한 휴대폰 번호';
COMMENT ON COLUMN public.sales_code_requests.status         IS '신청중 / 시트등록완료 / 처리완료 / 반려';
