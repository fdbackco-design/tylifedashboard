-- =========================================================
-- TY Life Dashboard - customers 중복 판별 키 보정
-- 2026-07-08
-- ---------------------------------------------------------
-- 배경:
--   기존 유니크 키가 (ssn_masked) 단독이었다.
--   그런데 ssn_masked 는 "생년월일 + 성별 자리"만 남긴 마스킹 값이라,
--   생일이 같은 서로 다른 사람(예: 김미옥/김태화, 620813)이 하나의
--   customer_id 로 병합되는 사고가 발생했다.
--   → 계약 귀속/조직도 표시가 오염됨(노드 hijacking 포함).
--
-- 조치:
--   유니크 키를 (ssn_masked, phone) 복합으로 변경한다.
--   - 전화번호는 sync 시 항상 문자열(digits, 없으면 '')로 저장되므로 NULL 문제 없음.
--   - 기존 (ssn_masked) 단독 유니크를 만족하던 데이터는 복합 유니크도 자명하게 만족 → 안전.
--   - 이후 upsert 는 onConflict=(ssn_masked, phone) 를 사용한다(코드 병행 수정).
--
-- 주의:
--   과거에 이미 병합된 오염 데이터(같은 ssn_masked 로 다른 사람이 섞인 행)는
--   이 마이그레이션으로 자동 분리되지 않는다. 별도 정리 SQL로 처리한다.
-- =========================================================

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_ssn_masked_unique;

-- 복합 유니크 (ssn_masked, phone)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_ssn_masked_phone_unique'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_ssn_masked_phone_unique UNIQUE (ssn_masked, phone);
  END IF;
END $$;
