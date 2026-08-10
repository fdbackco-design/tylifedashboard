-- branch_name 기본값/기존값: Ty Life Partners → Feed Life

ALTER TABLE public.manager_change_requests
  ALTER COLUMN branch_name SET DEFAULT 'Feed Life';

UPDATE public.manager_change_requests
SET branch_name = 'Feed Life'
WHERE branch_name = 'Ty Life Partners'
   OR branch_name = 'TY Life Partners';

COMMENT ON COLUMN public.manager_change_requests.branch_name IS
  '소속 지사명 (기본: Feed Life)';
