# 아키텍처 설계

## 전체 데이터 흐름

```
┌─────────────────────────────────────┐
│       TY Life 외부 시스템            │
│  POST /contract/list (페이지네이션)  │
│  GET  /contract/{id}  (HTML 상세)   │
└────────────────┬────────────────────┘
                 │ HTTPS + 세션 쿠키
                 ▼
┌─────────────────────────────────────┐
│       sync-service (서버 전용)       │
│  src/lib/tylife/                    │
│  ├── client.ts       (API 호출)     │
│  ├── detail-fetcher  (상세 HTML)    │
│  ├── html-parser     (파싱)         │
│  ├── normalize       (도메인 변환)  │
│  └── sync-service    (조율 레이어)  │
└────────────────┬────────────────────┘
                 │ Supabase SDK (service role)
                 ▼
┌─────────────────────────────────────┐
│       Supabase (PostgreSQL)         │
│                                     │
│  customers          contracts       │
│  org_members        org_edges       │
│  settlement_rules   monthly_sett.   │
│  sync_runs          sync_logs       │
│                                     │
│  RLS: 서버 키 = 전체 접근            │
│       anon 키 = 읽기 제한            │
└────────────────┬────────────────────┘
                 │ Supabase SDK (anon / server)
                 ▼
┌─────────────────────────────────────┐
│       Next.js App Router            │
│                                     │
│  Route Handlers (서버)              │
│  ├── /api/sync         동기화 실행  │
│  ├── /api/contracts    계약 목록    │
│  ├── /api/organization 조직 트리    │
│  └── /api/settlement   월별 정산    │
│                                     │
│  Server Components (관리자 페이지)  │
│  ├── /               대시보드       │
│  ├── /contracts      계약 리스트    │
│  ├── /organization   조직도         │
│  └── /settlement     정산 현황      │
└─────────────────────────────────────┘
```

---

## 수집 → 정규화 → 저장 → 정산 → 표시

### 1단계: 수집 (Collection)

```
sync-service.run()
  └── fetchContractList(page, size)          # POST /contract/list
        └── 페이지별 순회 (hasMore 체크)
              └── fetchContractDetail(id)    # GET /contract/{id}
                    └── parseDetailHtml()   # node-html-parser
```

- rate limit: 요청 사이 `TYLIFE_SYNC_RATE_LIMIT_MS` 딜레이
- 재시도: 최대 `TYLIFE_SYNC_MAX_RETRIES` 회, 지수 백오프
- 실패 건: sync_logs에 error 레벨 기록 후 다음 건 계속

### 2단계: 정규화 (Normalization)

```
normalize(rawListItem, rawDetailHtml)
  ├── extractCustomer()   → CustomerInsert
  ├── extractContract()   → ContractInsert
  └── extractMember()     → OrgMemberInsert (담당자)
```

- SSN 처리: `parseSsn(raw)` → `{ birth_date, gender, ssn_masked }`
- 전화번호: 원문 저장, 표시 시 `maskPhone()` 유틸 적용
- rental_request_no / memo: 숫자 판별 후 분기

### 3단계: 저장 (Storage)

```
upsert 순서 (FK 의존성 순):
  1. organization_members  (external_id 기준 upsert)
  2. organization_edges    (부모-자식 관계)
  3. customers             (ssn_masked 기준 upsert)
  4. contracts             (contract_code 기준 upsert)
  5. contract_status_histories (상태 변경 시만 insert)
```

### 4단계: 정산 (Settlement)

```
calculateMonthlySettlement(yearMonth)
  ├── 완료 계약 조회 (is_cancelled=false, status IN 정산 대상)
  ├── 담당자별 직접 구좌 집계
  ├── 조직 트리 재귀 순회 → 롤업 차액 계산
  ├── 유지 장려금 임계값 확인
  └── monthly_settlements upsert (calculation_detail JSONB 포함)
```

**롤업 계산 원리:**
- 영업사원 계약 → 영업사원: unit × 300,000
- 리더(직상위): unit × (400,000 - 300,000) = unit × 100,000
- 센터장: unit × (500,000 - 400,000) = unit × 100,000
- 사업본부장: unit × (설정값 - 500,000)

### 5단계: 표시 (Display)

```
Server Component
  └── Supabase 쿼리 (서버 클라이언트)
        └── props → UI 렌더링
              ├── 계약 리스트 (테이블)
              ├── 조직도 (트리 컴포넌트)
              └── 정산 (필터: 월/조직/담당자)
```

---

## 보안 레이어

| 레이어 | 접근 방식 |
|---|---|
| TY Life API | 서버 전용. `TYLIFE_SESSION_COOKIE` 환경변수 |
| Supabase (쓰기) | `SUPABASE_SERVICE_ROLE_KEY` 서버만 |
| Supabase (읽기) | Server Component에서 서버 클라이언트 사용 |
| sync API | `SYNC_API_SECRET` Bearer 토큰 검증 |
| RLS | 추후 인증 붙일 때 정책 추가 예정 (TODO) |

---

## 확장 포인트 (TODO)

- Vercel Cron으로 자동 동기화 스케줄 등록
- Supabase Auth 연동 → 담당자별 로그인
- RLS 정책 → 담당자는 자기 조직 데이터만 조회
- 사업본부장 수당 → `settlement_rules` 테이블에서 실시간 조회
- 웹훅 → 상태 변경 시 Slack/카카오 알림
