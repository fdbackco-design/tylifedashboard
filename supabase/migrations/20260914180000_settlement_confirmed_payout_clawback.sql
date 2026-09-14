-- =========================================================
-- 확정 지급 원장 + 계약별 환수 전기 (멱등)
-- 2026-09-14
--
-- 정책:
--   1) 정산월의 최종 확정 지급 배분을 계약코드·수령자별로 저장한다.
--   2) 취소 환수는 현재 조직도/직급으로 재계산하지 않고, 원장 수령자에게 역분개한다.
--   3) 동일 (환수월, 원정산월, 계약, 수령자, 유형) 재실행 시 중복 가산하지 않는다.
--   4) 본사만 환수하는 계약은 internal clawback 면제 플래그로 표시한다.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.settlement_confirmed_payout_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_year_month text NOT NULL,
  contract_code text NOT NULL,
  contract_id uuid NULL,
  recipient_member_id uuid NOT NULL REFERENCES public.organization_members (id),
  amount_type text NOT NULL CHECK (amount_type IN ('personal', 'rollup')),
  amount_won integer NOT NULL CHECK (amount_won >= 0),
  unit_count numeric NOT NULL DEFAULT 0,
  frozen boolean NOT NULL DEFAULT false,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_year_month, contract_code, recipient_member_id, amount_type)
);

CREATE INDEX IF NOT EXISTS idx_settlement_confirmed_payout_lines_month
  ON public.settlement_confirmed_payout_lines (source_year_month);
CREATE INDEX IF NOT EXISTS idx_settlement_confirmed_payout_lines_contract
  ON public.settlement_confirmed_payout_lines (contract_code);
CREATE INDEX IF NOT EXISTS idx_settlement_confirmed_payout_lines_recipient
  ON public.settlement_confirmed_payout_lines (recipient_member_id);

COMMENT ON TABLE public.settlement_confirmed_payout_lines IS
  '월정산 확정 지급 배분(계약코드×수령자). 환수 역분개의 SSOT.';

CREATE TABLE IF NOT EXISTS public.settlement_clawback_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clawback_year_month text NOT NULL,
  source_year_month text NOT NULL,
  contract_code text NOT NULL,
  contract_id uuid NULL,
  recipient_member_id uuid NOT NULL REFERENCES public.organization_members (id),
  amount_type text NOT NULL CHECK (amount_type IN ('personal', 'rollup')),
  amount_won integer NOT NULL CHECK (amount_won >= 0),
  internal_exempt boolean NOT NULL DEFAULT false,
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clawback_year_month, source_year_month, contract_code, recipient_member_id, amount_type)
);

CREATE INDEX IF NOT EXISTS idx_settlement_clawback_entries_month
  ON public.settlement_clawback_entries (clawback_year_month);
CREATE INDEX IF NOT EXISTS idx_settlement_clawback_entries_recipient
  ON public.settlement_clawback_entries (recipient_member_id, clawback_year_month);

COMMENT ON TABLE public.settlement_clawback_entries IS
  '취소 환수 전기. 원장 수령자 역분개. UNIQUE로 재실행 멱등.';

ALTER TABLE public.settlement_confirmed_payout_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_clawback_entries ENABLE ROW LEVEL SECURITY;
