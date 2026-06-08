-- =========================================================
-- user_profiles: 사전 계정 발급 + TY 동기화 자동 매핑 지원
-- 2026-06-08
--
-- 배경
--   - 기존 /admin/account-issue 는 customers/organization_members 데이터가
--     이미 존재하는 사람에 대해서만 계정을 발급할 수 있었다.
--   - 신규 영업자/고객에 대해 계약 또는 TY 동기화 이전에 미리 계정을 만들 수 있도록
--     "사전 계정 발급(pre-issue)" 흐름을 추가한다.
--   - 사전 발급 계정은 person/customer 와 연결되지 않은 채 생성되었다가, 이후
--     TY 동기화로 동일 이름(또는 이름+전화번호)을 가진 사람 데이터가 들어오면
--     자동으로 매핑된다(자동 매핑 규칙은 lib/account-issue/auto-mapping.ts 참고).
--
-- 본 마이그레이션
--   1) user_profiles 에 매핑 상태 컬럼 추가
--      - mapping_status: PENDING / MATCHED / MANUAL_REVIEW
--      - pre_issued_name / pre_issued_phone: 사전 발급 시 입력값(매칭 키)
--      - matched_at / matched_by / mapping_reason: 매핑 결과 감사용
--   2) 기존 데이터 보정:
--      - role='member' 이면서 member_id IS NULL 인 잔존 행은 PENDING 으로 마킹
--   3) "user_profiles_member_id_required_for_member" CHECK 제약을 갱신
--      - 기존: role='member' 이면 member_id NOT NULL
--      - 신규: PENDING 또는 MANUAL_REVIEW 상태는 NULL 허용 (사전 발급 잠정 상태)
--   4) 자동/수동 매핑 감사 로그 테이블 account_mapping_logs 추가
-- =========================================================

-- 1) 컬럼 추가 ----------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'MATCHED',
  ADD COLUMN IF NOT EXISTS pre_issued_name text,
  ADD COLUMN IF NOT EXISTS pre_issued_phone text,
  ADD COLUMN IF NOT EXISTS matched_at timestamptz,
  ADD COLUMN IF NOT EXISTS matched_by text,
  ADD COLUMN IF NOT EXISTS mapping_reason text;

-- 2) 값 도메인 제약 -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_mapping_status_check'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_mapping_status_check
      CHECK (mapping_status IN ('PENDING', 'MATCHED', 'MANUAL_REVIEW'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profiles_matched_by_check'
      AND conrelid = 'public.user_profiles'::regclass
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_matched_by_check
      CHECK (matched_by IS NULL OR matched_by IN ('AUTO_SYNC', 'ADMIN'));
  END IF;
END $$;

-- 3) 기존 행 보정 -------------------------------------------------------
-- 이미 정상 발급된 행은 mapping_status=MATCHED 디폴트로 둔다.
-- 그러나 과거 잔존 NULL member_id 행은 PENDING 으로 표시해 검토 가능 상태로 만든다.
UPDATE public.user_profiles
SET mapping_status = 'PENDING'
WHERE role = 'member'
  AND member_id IS NULL
  AND mapping_status = 'MATCHED';

-- 4) member_id 필수 CHECK 제약 재정의 ---------------------------------
-- 기존(직전 마이그레이션 20260604000000)에 추가된 제약은 PENDING/MANUAL_REVIEW 를 허용하지 않으므로
-- 사전 발급 행 INSERT 가 막힌다. PENDING/MANUAL_REVIEW 인 경우엔 NULL 허용으로 갱신.
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_member_id_required_for_member;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_member_id_required_for_member
  CHECK (
    role <> 'member'
    OR member_id IS NOT NULL
    OR mapping_status IN ('PENDING', 'MANUAL_REVIEW')
  );

-- 5) 인덱스 ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_profiles_mapping_status
  ON public.user_profiles (mapping_status);

-- 자동 매핑 시 lower(pre_issued_name) 으로 매칭하므로 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_user_profiles_pre_issued_name_lower
  ON public.user_profiles (lower(pre_issued_name));

-- 6) 매핑 감사 로그 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_mapping_logs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action          text        NOT NULL,
  user_profile_id uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  -- 매핑되었거나 후보가 된 organization_members.id (FK 는 생략: 후보 단계에서 잠정 기록 가능)
  member_id       uuid,
  pre_issued_name text,
  pre_issued_phone text,
  mapping_status  text,
  matched_by      text,
  candidate_type  text,
  reason          text,
  admin_id        uuid,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_mapping_logs_user_profile_id
  ON public.account_mapping_logs (user_profile_id);

CREATE INDEX IF NOT EXISTS idx_account_mapping_logs_created_at
  ON public.account_mapping_logs (created_at DESC);

ALTER TABLE public.account_mapping_logs ENABLE ROW LEVEL SECURITY;
-- service_role 만 사용하는 감사 테이블이라 별도 정책 없이 차단되도록 둔다.
