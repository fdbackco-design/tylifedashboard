-- 동명이인 김혜현 고객/영업자 분리 복구
-- 고객: 1974-05-03 / 01092337897
-- 영업자 계정: 1975-03-28 / 01059584998
DO $$
DECLARE
  v_customer_member_id uuid := 'f1abea91-b8bc-405e-b383-a505af6b7acf';
  v_customer_id uuid := 'd3e50cec-8c23-4d46-a851-998719e0e331';
  v_profile_id uuid := 'ac2257a4-e41c-4f11-b55d-3099b7ecdd2b';
  v_contract_id uuid := '9643137d-3f8b-4171-9d68-96186fbb0cec';
  v_employee_member_id uuid;
  v_parent_id uuid;
  v_performance_path jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers
    WHERE id = v_customer_id
      AND name = '김혜현'
      AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01092337897'
      AND birth_date = DATE '1974-05-03'
  ) THEN
    RAISE EXCEPTION '복구 대상 고객 김혜현의 식별 정보가 예상과 다릅니다.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE id = v_profile_id
      AND display_name = '김혜현'
      AND regexp_replace(coalesce(pre_issued_phone, phone, ''), '\D', '', 'g') = '01059584998'
  ) THEN
    RAISE EXCEPTION '복구 대상 영업자 김혜현 계정의 식별 정보가 예상과 다릅니다.';
  END IF;

  SELECT id
    INTO v_employee_member_id
  FROM public.organization_members
  WHERE name = '김혜현'
    AND id <> v_customer_member_id
    AND coalesce(external_id, '') NOT LIKE 'customer:%'
  ORDER BY created_at
  LIMIT 1;

  IF v_employee_member_id IS NULL THEN
    INSERT INTO public.organization_members (
      name,
      rank,
      phone,
      external_id,
      source_customer_id,
      is_active
    )
    VALUES (
      '김혜현',
      '영업사원',
      '01059584998',
      NULL,
      NULL,
      true
    )
    RETURNING id INTO v_employee_member_id;
  ELSE
    UPDATE public.organization_members
    SET phone = '01059584998',
        is_active = true,
        updated_at = now()
    WHERE id = v_employee_member_id;
  END IF;

  SELECT applicant_member_id
    INTO v_parent_id
  FROM public.sales_code_requests
  WHERE name = '김혜현'
    AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = '01059584998'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_parent_id IS NULL THEN
    RAISE EXCEPTION '영업자 김혜현의 조직 상위 신청자를 확인할 수 없습니다.';
  END IF;
  IF v_parent_id = v_employee_member_id THEN
    RAISE EXCEPTION '영업자 김혜현 조직 연결이 self-loop가 됩니다.';
  END IF;
  IF EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT child_id
      FROM public.organization_edges
      WHERE parent_id = v_employee_member_id
      UNION
      SELECT e.child_id
      FROM public.organization_edges e
      JOIN descendants d ON e.parent_id = d.child_id
    )
    SELECT 1 FROM descendants WHERE child_id = v_parent_id
  ) THEN
    RAISE EXCEPTION '영업자 김혜현 조직 연결 시 cycle이 발생합니다.';
  END IF;

  DELETE FROM public.organization_edges
  WHERE child_id = v_employee_member_id;
  INSERT INTO public.organization_edges (parent_id, child_id)
  VALUES (v_parent_id, v_employee_member_id)
  ON CONFLICT (child_id) DO UPDATE SET parent_id = EXCLUDED.parent_id;

  -- 잘못 고객 김혜현 아래에 붙은, 해당 담당 계약의 고객 노드만 실제 영업자 아래로 이동한다.
  UPDATE public.organization_edges e
  SET parent_id = v_employee_member_id
  WHERE e.parent_id = v_customer_member_id
    AND EXISTS (
      SELECT 1
      FROM public.organization_members child
      JOIN public.customers child_customer ON child_customer.id = child.source_customer_id
      JOIN public.contracts c ON c.id = v_contract_id
      JOIN public.customers contract_customer ON contract_customer.id = c.customer_id
      WHERE child.id = e.child_id
        AND c.source_snapshot_json ->> '담당자' = '김혜현'
        AND child_customer.name = contract_customer.name
        AND regexp_replace(coalesce(child_customer.phone, ''), '\D', '', 'g')
          = regexp_replace(coalesce(contract_customer.phone, ''), '\D', '', 'g')
        AND child_customer.birth_date = contract_customer.birth_date
    );

  UPDATE public.user_profiles
  SET member_id = v_employee_member_id,
      customer_id = NULL,
      mapping_status = 'MATCHED',
      matched_at = now(),
      matched_by = 'ADMIN',
      mapping_reason = 'HOMONYM_IDENTITY_REPAIR',
      updated_at = now()
  WHERE id = v_profile_id;

  WITH RECURSIVE ancestors AS (
    SELECT
      m.id,
      m.name,
      m.rank,
      0 AS depth,
      ARRAY[m.id]::uuid[] AS visited
    FROM public.organization_members m
    WHERE m.id = v_employee_member_id
    UNION ALL
    SELECT
      parent.id,
      parent.name,
      parent.rank,
      a.depth + 1,
      a.visited || parent.id
    FROM ancestors a
    JOIN public.organization_edges e ON e.child_id = a.id
    JOIN public.organization_members parent ON parent.id = e.parent_id
    WHERE NOT parent.id = ANY(a.visited)
  )
  SELECT jsonb_agg(
    jsonb_build_object('id', id, 'name', name, 'rank', rank)
    ORDER BY depth DESC
  )
  INTO v_performance_path
  FROM ancestors;

  UPDATE public.contracts
  SET sales_member_id = v_employee_member_id,
      sales_link_status = 'linked',
      raw_sales_member_name = NULL,
      performance_path_json = v_performance_path,
      updated_at = now()
  WHERE id = v_contract_id
    AND source_snapshot_json ->> '담당자' = '김혜현';

  DELETE FROM public.monthly_settlements
  WHERE member_id = v_customer_member_id
    AND year_month >= '2026-07'
    AND coalesce(direct_unit_count, 0) = 0
    AND coalesce(total_amount, 0) = 0;

  INSERT INTO public.account_mapping_logs (
    action,
    user_profile_id,
    member_id,
    pre_issued_name,
    pre_issued_phone,
    mapping_status,
    matched_by,
    candidate_type,
    reason,
    admin_id
  )
  SELECT
    'HOMONYM_IDENTITY_REPAIR',
    v_profile_id,
    v_employee_member_id,
    '김혜현',
    '01059584998',
    'MATCHED',
    'ADMIN',
    'MANAGER_NAME',
    'CUSTOMER_AND_MANAGER_IDENTITY_SPLIT',
    NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.account_mapping_logs
    WHERE user_profile_id = v_profile_id
      AND action = 'HOMONYM_IDENTITY_REPAIR'
      AND member_id = v_employee_member_id
  );
END
$$;
