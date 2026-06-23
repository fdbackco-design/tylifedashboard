-- 특정 조직원은 센터장 자동 승격에서 제외할 수 있도록 플래그를 추가한다.
-- (승격 조건을 만족해도 rank는 '리더'로 유지)

alter table public.organization_members
  add column if not exists lock_center_chief_promotion boolean not null default false;

