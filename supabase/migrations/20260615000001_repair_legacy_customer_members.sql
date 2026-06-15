-- ─────────────────────────────────────────────────────────
-- Repair legacy "customer-style" organization_members
--
-- 배경:
--   customer 가 정식 영업자로 승격될 때, 기존 임시 멤버 행
--   ("[고객] X", external_id='customer:<cid>', source_customer_id=NULL)
--   이 비활성화/재매핑되지 않고 그대로 남아 정합성이 어긋난 케이스가
--   다수 존재한다.
--
--   증상:
--   - user_profiles.member_id 가 옛 임시 멤버를 가리킴
--     → /admin/settlement_sheet 에서 링크 발행 실패
--     → 본인 로그인 시 빈 명세서/조직도가 노출
--   - organization_edges 에 옛 멤버가 자식으로 매달려 있음
--   - monthly_settlements 에 옛 멤버의 빈 행(0/0)이 누적
--
-- 전략 (단일 PL/pgSQL 블록 = 단일 트랜잭션):
--   1) 동일 customer_id 에 대해 옛 임시 멤버 ↔ 새 활성 멤버를
--      1:1 로 매핑할 수 있는 케이스만 추출 (모호한 후보 발견 시 ABORT)
--   2) organization_edges: child_id = legacy_id 인 행을
--      new_id 가 이미 edge 를 가지면 삭제, 없으면 new_id 로 이전
--      (child_id UNIQUE 제약을 위반하지 않도록)
--   3) user_profiles.member_id 를 new_id 로 갱신, display_name 에서
--      "[고객] " 접두어 제거
--   4) 옛 멤버의 monthly_settlements 빈 행(0/0) 삭제
--   5) 옛 멤버 is_active = FALSE
--
-- 안전 장치:
--   - 옛 멤버에 직접 영업한 계약(sales/contractor)이 있으면 ABORT
--   - 동일 customer_id 에 대해 new 후보가 2개 이상이면 ABORT
--   - 옛 멤버에 0원이 아닌 monthly_settlements 가 있으면 ABORT
--
-- 모든 문장을 하나의 anonymous DO 블록에 담아 Supabase SQL Editor 의
-- statement 분리 동작과 무관하게 동일 트랜잭션으로 실행되도록 한다.
-- ─────────────────────────────────────────────────────────

DO $$
DECLARE
  ambiguous_count INT;
  contract_count  INT;
  nonzero_count   INT;
  affected_pairs  INT;
  edges_deleted   INT;
  edges_moved     INT;
  profiles_fixed  INT;
  settlement_deleted INT;
  members_deactivated INT;
BEGIN
  -- 임시 매핑 테이블 (ON COMMIT DROP → 블록 종료 후 자동 정리)
  CREATE TEMP TABLE legacy_member_pairs ON COMMIT DROP AS
  SELECT DISTINCT
    legacy_m.id   AS legacy_id,
    new_m.id      AS new_id,
    p.customer_id AS customer_id,
    p.id          AS profile_id
  FROM user_profiles p
  JOIN organization_members legacy_m
    ON legacy_m.id = p.member_id
  JOIN organization_members new_m
    ON new_m.source_customer_id = p.customer_id
   AND new_m.id <> legacy_m.id
   AND new_m.is_active = TRUE
  WHERE legacy_m.external_id LIKE 'customer:%'
    AND legacy_m.source_customer_id IS NULL;

  SELECT COUNT(*) INTO affected_pairs FROM legacy_member_pairs;
  RAISE NOTICE 'Legacy member pairs detected: %', affected_pairs;

  IF affected_pairs = 0 THEN
    RAISE NOTICE 'Nothing to repair. Exiting.';
    RETURN;
  END IF;

  -- 안전 장치 1: 옛 멤버 ↔ 새 멤버 1:1 매핑이 깨졌으면 중단
  SELECT COUNT(*) INTO ambiguous_count
  FROM (
    SELECT customer_id
    FROM legacy_member_pairs
    GROUP BY customer_id
    HAVING COUNT(DISTINCT new_id) > 1
       OR COUNT(DISTINCT legacy_id) > 1
  ) s;
  IF ambiguous_count > 0 THEN
    RAISE EXCEPTION
      'Ambiguous legacy->new mapping for % customer(s); aborting repair.', ambiguous_count;
  END IF;

  -- 안전 장치 2: 옛 멤버에 실제 계약이 묶여 있으면 중단
  SELECT COUNT(*) INTO contract_count
  FROM contracts c
  JOIN legacy_member_pairs pair
    ON c.sales_member_id = pair.legacy_id
    OR c.contractor_member_id = pair.legacy_id;
  IF contract_count > 0 THEN
    RAISE EXCEPTION
      'Legacy members are referenced by % contract(s); aborting repair.', contract_count;
  END IF;

  -- 안전 장치 3: 옛 멤버에 0이 아닌 정산이 있으면 중단
  SELECT COUNT(*) INTO nonzero_count
  FROM monthly_settlements ms
  JOIN legacy_member_pairs pair ON ms.member_id = pair.legacy_id
  WHERE COALESCE(ms.total_amount, 0) <> 0
     OR COALESCE(ms.direct_unit_count, 0) <> 0;
  IF nonzero_count > 0 THEN
    RAISE EXCEPTION
      'Legacy members have % non-zero monthly_settlements row(s); aborting repair.', nonzero_count;
  END IF;

  -- 1) organization_edges 정리
  --    1a) 새 멤버에 이미 edge 가 있으면 옛 edge 는 단순 삭제
  WITH del AS (
    DELETE FROM organization_edges e
    USING legacy_member_pairs pair
    WHERE e.child_id = pair.legacy_id
      AND EXISTS (
        SELECT 1 FROM organization_edges e2 WHERE e2.child_id = pair.new_id
      )
    RETURNING e.id
  )
  SELECT COUNT(*) INTO edges_deleted FROM del;

  --    1b) 새 멤버에 edge 가 없는 경우엔 옛 edge.child_id 를 새 멤버로 이전
  WITH upd AS (
    UPDATE organization_edges e
    SET child_id = pair.new_id
    FROM legacy_member_pairs pair
    WHERE e.child_id = pair.legacy_id
    RETURNING e.id
  )
  SELECT COUNT(*) INTO edges_moved FROM upd;

  -- 2) user_profiles 재매핑 + "[고객] " 접두어 제거
  WITH upd AS (
    UPDATE user_profiles up
    SET
      member_id    = pair.new_id,
      display_name = REGEXP_REPLACE(COALESCE(up.display_name, ''), '^\[고객\]\s*', ''),
      updated_at   = NOW()
    FROM legacy_member_pairs pair
    WHERE up.id = pair.profile_id
    RETURNING up.id
  )
  SELECT COUNT(*) INTO profiles_fixed FROM upd;

  -- 3) 옛 멤버의 빈 monthly_settlements 행 삭제
  WITH del AS (
    DELETE FROM monthly_settlements ms
    USING legacy_member_pairs pair
    WHERE ms.member_id = pair.legacy_id
      AND COALESCE(ms.total_amount, 0) = 0
      AND COALESCE(ms.direct_unit_count, 0) = 0
    RETURNING ms.id
  )
  SELECT COUNT(*) INTO settlement_deleted FROM del;

  -- 4) 옛 멤버 비활성화
  WITH upd AS (
    UPDATE organization_members m
    SET
      is_active  = FALSE,
      updated_at = NOW()
    FROM legacy_member_pairs pair
    WHERE m.id = pair.legacy_id
    RETURNING m.id
  )
  SELECT COUNT(*) INTO members_deactivated FROM upd;

  RAISE NOTICE
    'Repair done. pairs=%, edges_deleted=%, edges_moved=%, profiles_fixed=%, empty_settlements_deleted=%, members_deactivated=%',
    affected_pairs, edges_deleted, edges_moved, profiles_fixed, settlement_deleted, members_deactivated;
END $$;
