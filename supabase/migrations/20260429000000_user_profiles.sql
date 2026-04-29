-- =========================================================
-- user_profiles
-- 관리자 계정 발급 → 사용자 로그인 → 개인 조직도 범위 제한용
-- 2026-04-29
-- =========================================================

CREATE TABLE IF NOT EXISTS public.user_profiles (
  -- auth.users PK와 1:1 매핑
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 선택: 해당 고객/조직원
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  member_id uuid REFERENCES public.organization_members(id) ON DELETE SET NULL,

  -- 로그인 ID (현재 구현은 Supabase Auth의 email로 사용)
  login_code text UNIQUE NOT NULL,
  display_name text,
  phone text,

  role text NOT NULL DEFAULT 'member',
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_customer_id ON public.user_profiles (customer_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_member_id ON public.user_profiles (member_id);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 본인 프로필만 조회/수정 가능
DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles
  FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "user_profiles_insert_own" ON public.user_profiles;
CREATE POLICY "user_profiles_insert_own"
  ON public.user_profiles
  FOR INSERT
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;
CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- updated_at 자동 갱신 트리거(기존 trigger_set_updated_at 재사용)
DROP TRIGGER IF EXISTS set_updated_at_user_profiles ON public.user_profiles;
CREATE TRIGGER set_updated_at_user_profiles
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

