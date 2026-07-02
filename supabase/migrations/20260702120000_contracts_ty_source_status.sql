-- TY 원본 가입 상태와 내부 운영 상태 분리
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS ty_source_status contract_status;

COMMENT ON COLUMN public.contracts.ty_source_status IS
  'TY Life 수집 원본 가입 상태. status(내부 운영 상태)와 분리하여 동기화 시 TY 대기/준비가 내부 가입을 되돌리지 않도록 한다.';

-- 기존 행: 마이그레이션 시점 status 를 원본으로 추정 (이후 동기화에서 TY 값으로 갱신)
UPDATE public.contracts
SET ty_source_status = status
WHERE ty_source_status IS NULL;
