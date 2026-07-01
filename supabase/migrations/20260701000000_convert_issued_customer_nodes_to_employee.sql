-- =========================================================
-- Convert issued customer-style org members to employee nodes
-- 2026-07-01
--
-- 배경:
-- - external_id = 'customer:{customer_id}' 형태의 customer:* 노드는 원래 "고객(계약자) 표시용" 가상 노드다.
-- - 하지만 계정 발급(user_profiles.mapping_status='MATCHED')이 완료된 경우,
--   해당 멤버는 더 이상 가상 노드로 취급하면 안 되고 "직원(담당자)"로 취급되어야 한다.
-- - 따라서 발급 완료된 customer:* 멤버에 대해 external_id를 NULL로 돌리고,
--   name의 '[고객] ' prefix를 제거하여 직원 노드로 정리한다.
--
-- 주의:
-- - 이 SQL은 "병합(contracts/edges FK 이동)"까지 수행하지 않고,
--   해당 member row 자체를 직원 스타일로 전환하는 최소 보정이다.
-- - source_customer_id는 보존된다(고객 식별 연계는 유지).
-- =========================================================

begin;

-- (선택) 영향 대상 미리보기
-- select
--   m.id,
--   m.name,
--   m.rank,
--   m.external_id,
--   m.source_customer_id,
--   p.id as user_profile_id,
--   p.login_code,
--   p.is_active,
--   p.mapping_status
-- from organization_members m
-- join user_profiles p on p.member_id = m.id
-- where (m.external_id like 'customer:%' or m.name like '[고객] %')
--   and p.mapping_status = 'MATCHED';

-- 1) external_id: customer:* → NULL (직원 노드로 전환)
update organization_members m
set external_id = null
where m.external_id like 'customer:%'
  and exists (
    select 1
    from user_profiles p
    where p.member_id = m.id
      and p.mapping_status = 'MATCHED'
  );

-- 2) name: "[고객] " prefix 제거 (표시/검색 일관성)
update organization_members m
set name = regexp_replace(m.name, '^\[고객\]\s*', '')
where m.name like '[고객] %'
  and exists (
    select 1
    from user_profiles p
    where p.member_id = m.id
      and p.mapping_status = 'MATCHED'
  );

commit;

