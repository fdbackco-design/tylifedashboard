-- =========================================================
-- TY Life Dashboard - Add missing contract/customer fields
-- 2026-04-13
-- =========================================================

-- contracts: 소속명 (list HTML에서 추출)
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS affiliation_name TEXT;

-- contracts: 해피콜 결과 (list HTML에서 추출)
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS happycall_result TEXT;

-- customers: ssn_masked UNIQUE constraint (upsert onConflict 지원)
-- 신규 프로젝트 가정 - 기존 중복 없음
ALTER TABLE customers
  ADD CONSTRAINT customers_ssn_masked_unique UNIQUE (ssn_masked);
