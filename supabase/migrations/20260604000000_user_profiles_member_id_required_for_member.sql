-- =========================================================
-- user_profiles: role='member' 인 계정은 member_id 가 필수
-- 2026-06-04
--
-- 배경
--   - "권한 없음(이 계정은 조직도에 연결된 권한(member_id)이 없습니다)" 화면은
--     /organization, /organization/tree, /organization/statement, /organization/notice 등에서
--     user_profiles.member_id IS NULL 인 경우에 노출된다.
--   - 자가가입(customer 이름 = sales_member 이름) 케이스가 과거 customers 검색 발급 경로로
--     member_id 가 NULL 인 채로 user_profiles 에 들어간 사례가 확인됨.
--   - 현재 코드(API/UI) 는 신규 발급 시 member_id 를 강제하지만, DB 레벨에는 가드가 없어
--     수동 SQL/Studio/과거 마이그레이션 경로로 여전히 NULL 행이 생길 수 있다.
--
-- 본 마이그레이션
--   - role='member' 인 행은 member_id NOT NULL 을 DB 가 강제하도록 CHECK 제약을 추가한다.
--   - admin 계정 등 role <> 'member' 인 행은 member_id NULL 허용을 유지한다.
--   - 잔존 NULL 데이터가 마이그레이션 시점에 남아있을 수 있으므로 NOT VALID 로 먼저 추가하여
--     기존 행 검증을 건너뛰고, 이후 VALIDATE 단계에서 한 번에 검증한다.
--     VALIDATE 에 실패하면 잔존 행을 정리하라는 신호이며, 제약 자체는 NOT VALID 상태로
--     남아 향후 INSERT/UPDATE 는 모두 차단된다.
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_profiles_member_id_required_for_member'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_member_id_required_for_member
      CHECK (role <> 'member' OR member_id IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

-- 잔존 NULL 정리가 끝났으면 VALIDATE 가 성공한다. 실패하더라도 본 마이그레이션은 통과해야 하므로
-- 예외를 잡아 NOTICE 로만 남긴다. (제약은 NOT VALID 상태로 유지되며 신규 NULL 은 계속 차단됨)
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.user_profiles
      VALIDATE CONSTRAINT user_profiles_member_id_required_for_member;
  EXCEPTION WHEN check_violation THEN
    -- RAISE NOTICE 의 첫 인수는 format string literal 이어야 하므로 한 줄로 둔다.
    RAISE NOTICE 'user_profiles_member_id_required_for_member: 기존 행에 NULL member_id 가 남아 있어 VALIDATE 를 건너뜁니다. 잔존 정리 후 다음을 직접 실행하세요: ALTER TABLE public.user_profiles VALIDATE CONSTRAINT user_profiles_member_id_required_for_member;';
  END;
END $$;
