-- 동명이인 고객 박미선이 이름만 같은 리더 박미선 노드로 재사용되어
-- 김윤정의 승급 walk가 오염된 데이터를 복구한다.
--
-- 고객: 박미선 / 1980-08-11 / 01071707562
-- 직원: 박미선 / 1986-04-13 / 01057656850
DO $$
DECLARE
  v_customer_id constant uuid := '23fb7fd1-c470-4ad7-abee-5f8892ccbdd0';
  v_kim_id constant uuid := '82d2d6dc-ebfb-44af-a3a2-5b52bd041e6d';
  v_employee_park_id constant uuid := 'a7bc77cb-fda1-4d7d-b28d-4cd9f22763c0';
  v_employee_park_parent_id constant uuid := 'e3ddf6d7-fd66-468b-896c-ef13b4aba91d';
  v_bad_threshold_contract_id constant uuid := '19415354-dda2-42a2-b765-61539f188dce';
  v_contract_ids constant uuid[] := ARRAY[
    '5d305a52-5e03-486c-a40b-403660197675'::uuid,
    '37488a39-62b2-4683-9771-dd1559a5ab0b'::uuid
  ];
  v_customer_member_id uuid;
  v_customer_edge_id uuid;
  v_deleted_event_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM customers
    WHERE id = v_customer_id
      AND name = '박미선'
      AND birth_date = DATE '1980-08-11'
      AND regexp_replace(phone, '[^0-9]', '', 'g') = '01071707562'
  ) THEN
    RAISE EXCEPTION '복구 대상 고객 identity가 예상값과 다릅니다: %', v_customer_id;
  END IF;

  SELECT id
  INTO v_customer_member_id
  FROM organization_members
  WHERE source_customer_id = v_customer_id
     OR external_id = 'customer:' || v_customer_id::text
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_customer_member_id IS NULL THEN
    INSERT INTO organization_members (
      name,
      rank,
      phone,
      external_id,
      source_customer_id,
      is_active
    )
    VALUES (
      '[고객] 박미선',
      '영업사원',
      '01071707562',
      'customer:' || v_customer_id::text,
      v_customer_id,
      true
    )
    RETURNING id INTO v_customer_member_id;
  END IF;

  IF v_customer_member_id = v_employee_park_id OR v_customer_member_id = v_kim_id THEN
    RAISE EXCEPTION '복구 대상 고객 노드가 기존 직원 노드와 충돌합니다: %', v_customer_member_id;
  END IF;

  -- 새 고객 leaf를 김윤정 아래에 연결한다. parent chain에 child가 있으면 순환이므로 중단한다.
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT parent_id
      FROM organization_edges
      WHERE child_id = v_kim_id
      UNION ALL
      SELECT e.parent_id
      FROM organization_edges e
      JOIN ancestors a ON e.child_id = a.parent_id
      WHERE a.parent_id IS NOT NULL
    )
    SELECT 1 FROM ancestors WHERE parent_id = v_customer_member_id
  ) THEN
    RAISE EXCEPTION '고객 노드 연결 시 조직 순환이 발생합니다: %', v_customer_member_id;
  END IF;

  INSERT INTO organization_edges (parent_id, child_id)
  VALUES (v_kim_id, v_customer_member_id)
  ON CONFLICT (child_id) DO UPDATE
  SET parent_id = EXCLUDED.parent_id
  WHERE organization_edges.is_manual = false
  RETURNING id INTO v_customer_edge_id;

  IF v_customer_edge_id IS NULL THEN
    SELECT id INTO v_customer_edge_id
    FROM organization_edges
    WHERE child_id = v_customer_member_id;
  END IF;

  INSERT INTO organization_edge_sources (edge_id, source_contract_id, created_by, note)
  SELECT v_customer_edge_id, c.id, 'homonym-customer-repair', '동명이인 고객 독립 노드 복구'
  FROM contracts c
  WHERE c.id = ANY(v_contract_ids)
    AND c.customer_id = v_customer_id
    AND c.sales_member_id = v_kim_id
  ON CONFLICT (edge_id, source_contract_id) DO UPDATE
  SET created_by = EXCLUDED.created_by,
      note = EXCLUDED.note;

  -- 고객 계약 처리 중 리더 박미선 edge가 김윤정 아래로 이동한 순간도 함께 복구한다.
  UPDATE organization_edges
  SET parent_id = v_employee_park_parent_id
  WHERE child_id = v_employee_park_id
    AND parent_id = v_kim_id
    AND is_manual = false;

  -- 사고 당시 리더 박미선 edge에 잘못 쌓인 두 고객 계약 source를 제거한다.
  DELETE FROM organization_edge_sources oes
  USING organization_edges oe
  WHERE oes.edge_id = oe.id
    AND oe.child_id = v_employee_park_id
    AND oes.source_contract_id = ANY(v_contract_ids);

  -- 리더 박미선의 정상 승급 이벤트는 보존하고 동기화 중 임시 강등만 되돌린다.
  UPDATE organization_members
  SET rank = '리더'
  WHERE id = v_employee_park_id
    AND rank = '영업사원'
    AND EXISTS (
      SELECT 1
      FROM leader_promotion_events
      WHERE member_id = v_employee_park_id
    );

  DELETE FROM leader_promotion_events
  WHERE member_id = v_kim_id
    AND threshold_contract_id = v_bad_threshold_contract_id
    AND leader_maintenance_bonus_paid_at IS NULL
    AND leader_maintenance_bonus_paid_year_month IS NULL;
  GET DIAGNOSTICS v_deleted_event_count = ROW_COUNT;

  IF v_deleted_event_count > 0 THEN
    UPDATE organization_members
    SET rank = '영업사원',
        leader_rank_effective_at = NULL
    WHERE id = v_kim_id
      AND rank = '리더';

    -- 잘못된 리더 직급으로 계산된 행은 노출하지 않는다.
    -- 2026-07/08 전체 월정산 재계산 시 이 행과 상위 rollup이 다시 생성된다.
    DELETE FROM monthly_settlements
    WHERE member_id = v_kim_id
      AND year_month >= '2026-07';
  END IF;
END
$$;
