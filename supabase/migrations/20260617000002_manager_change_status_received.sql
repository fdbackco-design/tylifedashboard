-- 담당자 변경 신청: status에 RECEIVED(접수완료) 추가

-- 기존 check constraint는 이름이 자동 생성될 수 있어, status 컬럼의 CHECK 를 DROP 후 재생성한다.
ALTER TABLE public.manager_change_requests
  DROP CONSTRAINT IF EXISTS manager_change_requests_status_check;

ALTER TABLE public.manager_change_requests
  ADD CONSTRAINT manager_change_requests_status_check
  CHECK (status IN ('PENDING', 'RECEIVED', 'COMPLETED'));

COMMENT ON COLUMN public.manager_change_requests.status IS 'PENDING=신청중, RECEIVED=접수완료(관리자 확인), COMPLETED=완료(동기화 반영)';

