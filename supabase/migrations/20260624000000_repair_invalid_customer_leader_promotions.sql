-- customer:* 가상 노드에 잘못 기록된 리더 승격 보정 (임종도, 김중권)
-- 원인: 조직도 페이지 렌더 시 승격 backfill + customer 노드 승격 대상 포함
UPDATE organization_members
SET rank = '영업사원'
WHERE id IN (
  'b7cb42cd-9516-4674-9b84-fb973ef88a64',
  '18b313f4-21be-4cb9-af1e-1dcfdda84e84'
)
AND external_id LIKE 'customer:%'
AND rank = '리더';

DELETE FROM leader_promotion_events
WHERE member_id IN (
  'b7cb42cd-9516-4674-9b84-fb973ef88a64',
  '18b313f4-21be-4cb9-af1e-1dcfdda84e84'
);

-- 위 잘못된 리더 2명이 산하 리더 수에 포함되어 센터장으로 승격된 조명희 보정
UPDATE organization_members
SET rank = '리더'
WHERE id = 'bcfc9261-3cc9-48e0-b45f-2b560c2b0375'
AND rank = '센터장';
