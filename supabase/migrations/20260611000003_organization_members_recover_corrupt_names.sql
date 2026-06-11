-- =========================================================
-- 2026-06-11
-- organization_members.name 가 JSON 문자열로 통째로 저장된 row 를 복구한다.
--   예) name = '{"idx":0,"name":"임혜진",...}'
--
-- 안전을 위해:
--   - name 이 '{' 로 시작하고 '"name"' 키를 포함하는 row 만 대상으로 한다.
--   - JSON 파싱 실패는 무시한다(try/except).
--   - 추출한 name 이 비어 있거나 원본과 동일하면 갱신하지 않는다.
--   - 1회 데이터 정리이며 컬럼/제약은 손대지 않는다.
-- =========================================================

DO $$
DECLARE
  r RECORD;
  extracted text;
BEGIN
  FOR r IN
    SELECT id, name
      FROM public.organization_members
     WHERE name LIKE '{%'
       AND name LIKE '%"name"%'
  LOOP
    BEGIN
      extracted := (r.name::jsonb ->> 'name');
    EXCEPTION WHEN OTHERS THEN
      extracted := NULL;
    END;

    IF extracted IS NOT NULL
       AND length(btrim(extracted)) > 0
       AND extracted <> r.name
    THEN
      UPDATE public.organization_members
         SET name = extracted,
             updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
END
$$;
