-- =========================================================
-- TY케어플랜 24개월 상태 추적 + 모집/유지수당 원장
-- 2026-10-01
-- =========================================================

ALTER TABLE public.monthly_settlements
  ADD COLUMN IF NOT EXISTS care_plan_commission integer NOT NULL DEFAULT 0;

ALTER TABLE public.settlement_statement_overrides
  ADD COLUMN IF NOT EXISTS care_plan_commission integer;

COMMENT ON COLUMN public.monthly_settlements.care_plan_commission IS
  'TY케어플랜 모집수당+유지수당. 직급수당/롤업과 분리.';
COMMENT ON COLUMN public.settlement_statement_overrides.care_plan_commission IS
  '정산현황 케어플랜 수당 수동 보정값(NULL=자동 계산값).';

CREATE TABLE IF NOT EXISTS public.care_plan_contract_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL UNIQUE REFERENCES public.contracts(id) ON DELETE CASCADE,
  contract_code text NOT NULL UNIQUE,
  joined_at date NOT NULL,
  tracking_expires_at date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  terminal_status contract_status,
  terminal_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_care_plan_watchlist_active
  ON public.care_plan_contract_watchlist (is_active, tracking_expires_at);

COMMENT ON TABLE public.care_plan_contract_watchlist IS
  'TY케어플랜 계약을 가입일부터 24개월간 list-only 상태 추적.';

CREATE TABLE IF NOT EXISTS public.care_plan_commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  contract_code text NOT NULL,
  recipient_member_id uuid NOT NULL REFERENCES public.organization_members(id),
  earning_year_month text NOT NULL CHECK (earning_year_month ~ '^\d{4}-\d{2}$'),
  commission_type text NOT NULL
    CHECK (commission_type IN ('recruitment', 'maintenance', 'retroactive')),
  installment_no integer NOT NULL DEFAULT 0
    CHECK (installment_no BETWEEN 0 AND 24),
  unit_count integer NOT NULL DEFAULT 0 CHECK (unit_count >= 0),
  unit_amount_won integer NOT NULL DEFAULT 0 CHECK (unit_amount_won >= 0),
  amount_won integer NOT NULL CHECK (amount_won >= 0),
  override_amount_won integer CHECK (override_amount_won IS NULL OR override_amount_won >= 0),
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'held', 'void')),
  source text NOT NULL DEFAULT 'automatic'
    CHECK (source IN ('automatic', 'manual_retroactive', 'manual')),
  hold_reason text,
  paid_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_code, commission_type, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_care_plan_commission_entries_month_member
  ON public.care_plan_commission_entries (earning_year_month, recipient_member_id);
CREATE INDEX IF NOT EXISTS idx_care_plan_commission_entries_contract
  ON public.care_plan_commission_entries (contract_code);
CREATE INDEX IF NOT EXISTS idx_care_plan_commission_entries_payment
  ON public.care_plan_commission_entries (payment_status, earning_year_month);

COMMENT ON TABLE public.care_plan_commission_entries IS
  '케어플랜 계약코드별 모집 1회·유지 1~24회 지급 원장. UNIQUE로 재계산 중복 지급 방지.';
COMMENT ON COLUMN public.care_plan_commission_entries.override_amount_won IS
  '계약·회차별 수동 보정액(NULL=amount_won).';
COMMENT ON COLUMN public.care_plan_commission_entries.payment_status IS
  'pending=지급예정, paid=송금완료, held=보류, void=지급제외.';

DROP TRIGGER IF EXISTS trg_care_plan_watchlist_updated_at
  ON public.care_plan_contract_watchlist;
CREATE TRIGGER trg_care_plan_watchlist_updated_at
  BEFORE UPDATE ON public.care_plan_contract_watchlist
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS trg_care_plan_commission_entries_updated_at
  ON public.care_plan_commission_entries;
CREATE TRIGGER trg_care_plan_commission_entries_updated_at
  BEFORE UPDATE ON public.care_plan_commission_entries
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.care_plan_contract_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.care_plan_commission_entries ENABLE ROW LEVEL SECURITY;

-- 2026-08 소급 지급안. 당시 계약코드 원본이 아직 24개월 backfill 전이므로
-- 정산서 기준 묶음 원장으로 기록하며, 향후 원계약 확인 시 contract_code를 교체한다.
INSERT INTO public.care_plan_commission_entries (
  contract_code, recipient_member_id, earning_year_month, commission_type,
  installment_no, unit_count, unit_amount_won, amount_won, payment_status, source, note
) VALUES
  ('RETRO-2026-08-JOYICHAN', '40605438-9fc8-4dac-acda-f8b37c3add5b', '2026-08',
   'retroactive', 0, 10, 0, 133092, 'pending', 'manual_retroactive',
   '정산서 기준 소급 지급안: 모집 6구좌 109,092원 + 유지 4회분 24,000원'),
  ('RETRO-2026-08-KIMDONGWOOK', '7531a0c6-e5ce-4bd4-9459-94e4a59650b3', '2026-08',
   'retroactive', 0, 4, 0, 48364, 'pending', 'manual_retroactive',
   '정산서 기준 소급 지급안: 모집 2구좌 36,364원 + 유지 2회분 12,000원'),
  ('RETRO-2026-08-JANGSEONGHUN', '4a77bc4a-e23f-412b-8fe4-d2747e899f82', '2026-08',
   'retroactive', 0, 3, 0, 42364, 'pending', 'manual_retroactive',
   '정산서 기준 소급 지급안: 모집 2구좌 36,364원 + 유지 1회분 6,000원'),
  ('HOLD-2026-08-YOOEUNGYEONG-SONGYOUNGHO', 'bfa51a01-1b31-42ba-a5c2-4e6180be0678', '2026-08',
   'retroactive', 0, 4, 0, 48364, 'held', 'manual_retroactive',
   '송영호 해약 2구좌 유은경분. 본사 환수 여부 확인 전 지급 보류')
ON CONFLICT (contract_code, commission_type, installment_no) DO NOTHING;

-- 확정 여부와 무관하게 8월 소급 지급안을 케어플랜 열/합계에 1회성으로 반영한다.
-- 기존 care_plan_commission 값을 먼저 빼고 목표값을 더하므로 재실행해도 중복 가산되지 않는다.
WITH retro(member_id, amount_won) AS (
  VALUES
    ('40605438-9fc8-4dac-acda-f8b37c3add5b'::uuid, 133092),
    ('7531a0c6-e5ce-4bd4-9459-94e4a59650b3'::uuid, 48364),
    ('4a77bc4a-e23f-412b-8fe4-d2747e899f82'::uuid, 42364)
)
UPDATE public.monthly_settlements ms
SET
  total_amount = ms.total_amount - COALESCE(ms.care_plan_commission, 0) + retro.amount_won,
  care_plan_commission = retro.amount_won,
  calculation_detail = jsonb_set(
    COALESCE(ms.calculation_detail, '{}'::jsonb),
    '{care_plan_commission_amount}',
    to_jsonb(retro.amount_won),
    true
  ),
  updated_at = now()
FROM retro
WHERE ms.year_month = '2026-08'
  AND ms.member_id = retro.member_id;
