-- =========================================================
-- contracts: 정산용 담당자 override 컬럼 + 변경 이력 테이블
-- 2026-06-10
--
-- 배경
--   TY 본사 전산의 담당자 값이 잘못 들어와 contracts.sales_member_id 가 부정확한 경우,
--   관리자가 조직도/계약별로 정산용 담당자를 보정할 수 있어야 한다. 단:
--     - TY 동기화는 sales_member_id (원본) 만 갱신하며, settlement_sales_member_id 는 절대 덮어쓰지 않는다.
--     - 정산 계산 시에는 settlement_sales_member_id 가 있으면 그 값을 우선 사용한다.
--       const effective = settlement_sales_member_id ?? sales_member_id;
--
-- 본 마이그레이션은 컬럼/이력 테이블 추가만 한다. 로직 변경은 코드 측에서 수행한다.
-- =========================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS settlement_sales_member_id   uuid REFERENCES public.organization_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sales_member_override_reason text,
  ADD COLUMN IF NOT EXISTS sales_member_override_by     text,
  ADD COLUMN IF NOT EXISTS sales_member_overridden_at   timestamptz;

COMMENT ON COLUMN public.contracts.settlement_sales_member_id IS
  '정산용 담당자 override (관리자 수동 보정). NULL이면 sales_member_id 를 그대로 사용. TY 동기화는 절대 이 컬럼을 덮어쓰지 않는다.';

CREATE INDEX IF NOT EXISTS idx_contracts_settlement_sales_member_id
  ON public.contracts (settlement_sales_member_id)
  WHERE settlement_sales_member_id IS NOT NULL;

-- 변경 이력 (감사용)
CREATE TABLE IF NOT EXISTS public.contract_settlement_sales_member_history (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id                         uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  previous_settlement_sales_member_id uuid,
  new_settlement_sales_member_id      uuid,
  previous_sales_member_id            uuid,
  reason                              text,
  changed_by                          text NOT NULL,
  changed_at                          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csm_history_contract
  ON public.contract_settlement_sales_member_history (contract_id);

CREATE INDEX IF NOT EXISTS idx_csm_history_changed_at
  ON public.contract_settlement_sales_member_history (changed_at DESC);
