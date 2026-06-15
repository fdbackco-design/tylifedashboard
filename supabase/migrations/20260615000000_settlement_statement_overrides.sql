-- =========================================================
-- settlement_statement_overrides
-- 2026-06-15
--
-- 관리자가 영업자별 "지급명세서 표시값"을 수동으로 보정하기 위한 테이블.
--
-- 정산 계산 로직(monthly_settlements 생성, 직접/롤업 수당 계산 등)은 본 테이블을 절대
-- 참조하지 않는다. 본 테이블은 오직 "/organization/statement/{tyCode}" 외부 공유용
-- 지급명세서와 "/admin/settlement_sheet" 관리자 화면의 표시 단계에서만 사용된다.
--
-- 우선순위(표시값):
--   1) settlement_statement_overrides 에 해당 (year_month, member_id) 행이 있고 컬럼이 NOT NULL → 그 값
--   2) 그 외 → monthly_settlements 의 원본 값
--
-- 각 컬럼은 NULL 허용 → "기본값(자동 계산) 그대로 사용" 을 의미.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.settlement_statement_overrides (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  year_month            text        NOT NULL CHECK (year_month ~ '^\d{4}-\d{2}$'),
  member_id             uuid        NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,

  -- 표시 보정값 (NULL = monthly_settlements 원본 사용)
  personal_unit_count   integer,    -- 개인 실적 구좌
  downline_unit_count   integer,    -- 산하 실적 구좌
  personal_commission   integer,    -- 개인 수당 (원)
  override_amount       integer,    -- 오버라이드 (원, monthly_settlements.rollup_commission 대체)
  bonus_amount          integer,    -- 성과 장려금/보너스 (원)

  -- 관리자 메모(선택)
  memo                  text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (year_month, member_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_statement_overrides_year_month
  ON public.settlement_statement_overrides (year_month);
CREATE INDEX IF NOT EXISTS idx_settlement_statement_overrides_member
  ON public.settlement_statement_overrides (member_id);

CREATE OR REPLACE FUNCTION public.tg_settlement_statement_overrides_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_statement_overrides_updated_at
  ON public.settlement_statement_overrides;
CREATE TRIGGER trg_settlement_statement_overrides_updated_at
  BEFORE UPDATE ON public.settlement_statement_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_settlement_statement_overrides_set_updated_at();

-- RLS: 서버 사이드(service_role) 에서만 접근. 클라이언트 anon 접근 차단.
ALTER TABLE public.settlement_statement_overrides ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  public.settlement_statement_overrides
  IS '관리자 보정값 (지급명세서 표시 전용). 정산 계산 로직은 본 테이블을 참조하지 않는다.';
COMMENT ON COLUMN public.settlement_statement_overrides.personal_unit_count
  IS '개인 실적 구좌 (NULL = monthly_settlements.direct_unit_count 사용)';
COMMENT ON COLUMN public.settlement_statement_overrides.downline_unit_count
  IS '산하 실적 구좌 (NULL = 자동 산출값 사용)';
COMMENT ON COLUMN public.settlement_statement_overrides.personal_commission
  IS '개인 수당, 원 (NULL = monthly_settlements.base_commission 사용)';
COMMENT ON COLUMN public.settlement_statement_overrides.override_amount
  IS '오버라이드, 원 (NULL = monthly_settlements.rollup_commission 사용)';
COMMENT ON COLUMN public.settlement_statement_overrides.bonus_amount
  IS '성과 장려금/보너스, 원 (NULL = monthly_settlements.incentive_amount 사용)';
