# 도메인 모델

## 엔티티 관계 개요

```
organization_members ◄──── organization_edges (부모-자식)
        │
        │ (sales_member_id)
        ▼
    contracts ────────────► customers
        │                      (고객 기본정보)
        │
        ├──► contract_status_histories
        │
        └──► monthly_settlements ◄──── settlement_rules
```

---

## 엔티티 상세

### Customer (고객)

고객은 계약의 실질적 주체. 동일 고객이 여러 계약을 가질 수 있다.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | UUID | PK |
| name | TEXT | 고객명 |
| birth_date | DATE | 주민번호 앞자리에서 추출한 생년월일 |
| gender | CHAR(1) | 'M' / 'F' (주민번호 7번째 자리 기반) |
| ssn_masked | TEXT | "901201-1******" 형식. 뒷자리 원문 저장 금지 |
| phone | TEXT | 전화번호 (원문. 화면에서 maskPhone 적용) |

> **주민번호 처리 원칙**: 원문은 저장하지 않는다.  
> 생년월일(birth_date)과 성별(gender)은 파생 가능한 정보지만 서비스에 필요하므로 별도 필드로 저장.  
> 뒷자리 6자리는 절대 저장하지 않으며 ssn_masked에는 첫 자리 1글자만 노출.

---

### Contract (계약)

핵심 거래 단위. 계약 1건 = 구좌 N개.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | UUID | PK |
| sequence_no | SERIAL | 순번 (리스트 표시용) |
| contract_code | TEXT | 고유 계약 코드 (TY Life 기준) |
| rental_request_no | TEXT | 숫자인 경우 렌탈신청번호 |
| memo | TEXT | 숫자가 아닌 경우 메모 |
| customer_id | UUID | FK → customers |
| sales_member_id | UUID | FK → organization_members |
| join_date | DATE | 가입일 |
| product_type | ENUM | TY갤럭시케어 / 무 / 일반 |
| item_name | TEXT | 물품명 |
| watch_fit | ENUM | 갤럭시워치 / 갤럭시핏 / 해당없음 |
| unit_count | INTEGER | 가입 구좌 수 (정산 핵심값) |
| join_method | ENUM | 해피콜 / 간편가입 / 기타 |
| status | ENUM | 계약 진행 상태 |
| happy_call_at | TIMESTAMPTZ | 해피콜 완료 일시 |
| is_cancelled | BOOLEAN | 취소/반품 여부. true면 당월 정산 제외 |
| beneficiary_name | TEXT | 실제 헬스케어 서비스 이용 지정인 |
| relationship_to_contractor | TEXT | 계약자와의 관계 |

**계약 상태 흐름:**
```
준비 → 대기 → 상담중 → 가입 → 해피콜완료 → 배송준비 → 배송완료 → 정산완료
                                                               ↓
                                                          취소 / 해약
```

---

### OrganizationMember (조직원)

영업 담당자. 직급 계층으로 관리.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | UUID | PK |
| name | TEXT | 이름 |
| rank | ENUM | 영업사원 / 리더 / 센터장 / 사업본부장 / 본사 |
| external_id | TEXT | TY Life 시스템 ID (upsert 기준) |
| is_active | BOOLEAN | 재직 여부 |

**직급 계층 (아래 → 위):**
```
영업사원 → 리더 → 센터장 → 사업본부장 → 본사
```

---

### OrganizationEdge (조직 관계)

adjacency list 방식. 각 멤버는 최대 1개의 부모를 가진다.

| 필드 | 타입 | 설명 |
|---|---|---|
| parent_id | UUID | 상위 조직원 (NULL이면 최상위) |
| child_id | UUID | UNIQUE. 하위 조직원 |

재귀 CTE로 전체 하위 구조 조회 가능:
```sql
WITH RECURSIVE tree AS (
  SELECT id, name, rank, 0 AS depth
  FROM organization_members WHERE id = $1
  UNION ALL
  SELECT m.id, m.name, m.rank, t.depth + 1
  FROM organization_members m
  JOIN organization_edges e ON e.child_id = m.id
  JOIN tree t ON t.id = e.parent_id
)
SELECT * FROM tree;
```

---

### SettlementRule (정산 규칙)

직급별 수당 설정. `effective_from/until`으로 기간 관리.

| 직급 | commission_per_unit | incentive_threshold | incentive_amount |
|---|---|---|---|
| 영업사원 | 300,000 | - | - |
| 리더 | 400,000 | 20구좌 | 1,000,000 |
| 센터장 | 500,000 | 100구좌 | 3,000,000 |
| 사업본부장 | DB 설정값 | 300구좌 | 5,000,000 |

> 사업본부장 수당은 settlement_rules 테이블에서 관리. 하드코딩하지 않음.

---

### MonthlySettlement (월별 정산 스냅샷)

재계산 가능한 스냅샷 테이블. `calculation_detail` JSONB에 계산 근거 전체 저장.

| 필드 | 설명 |
|---|---|
| year_month | 'YYYY-MM' 형식 |
| member_id | 담당자 |
| direct_unit_count | 본인 직접 계약 구좌 합계 |
| subordinate_unit_count | 산하 전체 구좌 합계 |
| base_commission | 직접 계약 기본 수당 |
| rollup_commission | 하위 조직 롤업 차액 수당 |
| incentive_amount | 유지 장려금 |
| total_amount | 최종 정산 금액 |
| calculation_detail | JSONB 계산 근거 전체 |
| is_finalized | 확정 여부 (확정 후 재계산 불가) |

---

### SyncRun / SyncLog (동기화 기록)

| 필드 | 설명 |
|---|---|
| sync_runs.status | running / completed / failed |
| sync_runs.total_fetched | 수집한 계약 건수 |
| sync_runs.total_errors | 오류 건수 |
| sync_logs.level | info / warn / error |
| sync_logs.context | JSONB (오류 상세, 재시도 정보 등) |
