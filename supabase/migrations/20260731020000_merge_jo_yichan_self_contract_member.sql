-- 자기계약 동일인 조이찬의 customer/account 노드와 2026-07-31 생성된 중복 담당자 노드를 병합한다.
DO $$
DECLARE
  v_keep_id uuid := '40605438-9fc8-4dac-acda-f8b37c3add5b';
  v_duplicate_id uuid := '7fda773b-0d37-4bdf-96f8-54d7071eccae';
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE id = v_keep_id
      AND name = '조이찬'
      AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01075442089'
      AND external_id = 'customer:e59dcbb4-e422-4bbc-bad7-6cfa88c86d1f'
  ) THEN
    RAISE EXCEPTION '유지할 조이찬 조직원 노드의 식별 정보가 예상과 다릅니다.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE id = v_duplicate_id) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE id = v_duplicate_id
      AND (
        name <> '조이찬'
        OR regexp_replace(coalesce(phone, ''), '\D', '', 'g') <> '01075442089'
        OR source_customer_id IS NOT NULL
        OR external_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION '삭제할 조이찬 중복 노드의 식별 정보가 예상과 다릅니다.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.monthly_settlements
    WHERE member_id = v_duplicate_id
      AND (
        coalesce(direct_unit_count, 0) <> 0
        OR coalesce(subordinate_unit_count, 0) <> 0
        OR coalesce(total_amount, 0) <> 0
      )
  ) THEN
    RAISE EXCEPTION '중복 조이찬 노드에 0이 아닌 정산 데이터가 있어 자동 병합을 중단합니다.';
  END IF;

  UPDATE public.contracts SET sales_member_id = v_keep_id WHERE sales_member_id = v_duplicate_id;
  UPDATE public.contracts SET contractor_member_id = v_keep_id WHERE contractor_member_id = v_duplicate_id;
  UPDATE public.contracts SET settlement_sales_member_id = v_keep_id WHERE settlement_sales_member_id = v_duplicate_id;

  UPDATE public.organization_edges
  SET parent_id = v_keep_id
  WHERE parent_id = v_duplicate_id
    AND child_id <> v_keep_id;
  DELETE FROM public.organization_edges WHERE child_id = v_duplicate_id;

  UPDATE public.user_profiles SET member_id = v_keep_id, updated_at = now() WHERE member_id = v_duplicate_id;
  UPDATE public.sales_code_requests SET applicant_member_id = v_keep_id WHERE applicant_member_id = v_duplicate_id;
  UPDATE public.manager_change_requests SET requester_member_id = v_keep_id WHERE requester_member_id = v_duplicate_id;

  DELETE FROM public.monthly_settlements WHERE member_id = v_duplicate_id;
  DELETE FROM public.organization_members WHERE id = v_duplicate_id;
END
$$;
