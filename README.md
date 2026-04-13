# TY Life Dashboard

TY Life 계약 데이터를 수집·정규화하여 조직별 정산 및 계약 현황을 관리하는 관리자 웹앱.

## 기술 스택

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **DB**: Supabase (PostgreSQL + RLS)
- **배포**: Vercel
- **스타일**: Tailwind CSS

---

## 아키텍처 개요

```
TY Life 외부 시스템
    │ POST /contract/list  (목록 API)
    │ GET  /contract/{id}  (HTML 상세 페이지)
    ▼
sync-service (서버 전용)
    ├── html-parser      → 상세 페이지 파싱
    ├── normalize        → 도메인 모델 변환
    └── Supabase upsert  → DB 저장 + 동기화 로그

Supabase PostgreSQL
    ├── customers / contracts
    ├── organization_members + edges
    ├── settlement_rules / monthly_settlements
    └── sync_runs / sync_logs

Next.js App Router
    ├── (admin)/ → 대시보드, 계약, 조직도, 정산 페이지
    └── api/     → sync, contracts, organization, settlement
```

상세 설명은 [docs/architecture.md](docs/architecture.md) 참고.

---

## 환경변수

`.env.example`을 복사하여 `.env.local`로 생성 후 실제 값을 입력하세요.

| 키 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (클라이언트용) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (서버 전용) |
| `TYLIFE_BASE_URL` | TY Life 외부 시스템 베이스 URL |
| `TYLIFE_SESSION_COOKIE` | 로그인 세션 쿠키 (서버 전용) |
| `TYLIFE_SYNC_PAGE_SIZE` | 동기화 페이지당 건수 (기본: 50) |
| `TYLIFE_SYNC_RATE_LIMIT_MS` | 요청 간 딜레이 ms (기본: 500) |
| `TYLIFE_SYNC_MAX_RETRIES` | 실패 시 재시도 횟수 (기본: 3) |
| `SYNC_API_SECRET` | 수동 sync API 보호용 Bearer 토큰 |

---

## 실행 방법

```bash
# 의존성 설치
npm install

# 개발 서버
npm run dev

# 타입 체크
npm run type-check

# 빌드
npm run build
```

### Supabase 마이그레이션

```bash
# Supabase CLI 설치 후
supabase db push
# 또는 Supabase 대시보드 SQL 에디터에 마이그레이션 파일 직접 실행
```

---

## 동기화 흐름

### 자동 동기화 (TODO: Vercel Cron 설정 필요)

```
매일 새벽 2시 → POST /api/sync (SYNC_API_SECRET 인증)
```

### 수동 동기화

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Authorization: Bearer $SYNC_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"mode": "full"}'
```

### 동기화 단계

1. `sync_runs` 레코드 생성 (상태: running)
2. TY Life `/contract/list` 페이지 순회
3. 각 계약 `/contract/{id}` 상세 HTML 파싱
4. 고객/계약/담당자 정규화 및 upsert
5. `sync_runs` 완료 처리 + `sync_logs` 기록
6. 오류 발생 시 rate limit / 재시도 적용 후 개별 건만 skip

---

## 보안 원칙

- **주민등록번호**: 원문 저장 금지. `birth_date` + `gender` + `ssn_masked` 만 저장
- **전화번호**: DB 원문 저장, 화면 표시 시 마스킹 유틸 적용
- **세션 쿠키**: 환경변수로만 관리, 코드/DB/로그에 기록 금지
- **Supabase RLS**: 서비스 역할 키는 서버 전용. 클라이언트는 anon key만 사용

---

## 도메인 모델

[docs/domain-model.md](docs/domain-model.md) 참고.
