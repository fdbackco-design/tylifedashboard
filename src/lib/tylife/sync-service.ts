/**
 * TY Life 동기화 서비스.
 * 서버 전용. 브라우저에서 호출 금지.
 *
 * 주요 함수:
 *   syncContractPage(page, opts) — 단일 페이지 동기화
 *   runSync(opts)                — 전체 동기화 (syncContractPage 반복)
 *
 * 흐름 (페이지당):
 *   1. fetchContractList(page) → data.listHtml
 *   2. parseContractListHtml(listHtml) → ParsedListItem[]
 *   3. 각 항목:
 *      a. customer upsert (ssn_masked 기준)
 *      b. organization_member upsert (external_id 기준 or 이름 조회)
 *      c. contract upsert (contract_code 기준) — source_snapshot_json 포함
 *      d. 상세 HTML fetch → unit_count / item_name 보강 (실패 시 계속)
 */

import { createAdminSupabaseClient } from '../supabase/server';
import { fetchContractList, fetchContractDetailHtml } from './client';
import { parseContractListHtml, parseContractDetailHtml } from './html-parser';
import {
  DEFAULT_ITEM_NAME_PLACEHOLDER,
  normalizeCustomerFromList,
  normalizeContractFromList,
  mergeDetailIntoContract,
  normalizeSalesMember,
  normalizeStatus,
} from './normalize';
import type {
  SyncResult,
  SyncOptions,
  SyncRun,
  ParsedListItem,
} from '../types/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ContractInsert } from '../types/contract';
import { buildPerformancePath } from '../organization/performance-path';
import { resolveSalesMemberByNameOnly } from './sales-resolution';
import { resolveContractorByNameOnly } from './contractor-resolution';

function shouldExcludeRecruitmentName(name: string, relationship: string): boolean {
  const n = name.trim();
  if (!n) return true;
  // 계약자와의 관계 값이 계약자명으로 잘못 들어오는 케이스 방지
  const rel = relationship.trim();
  const banned = new Set([
    '자녀',
    '가족',
    '모',
    '부',
    '아내',
    '자',
    // 흔한 변형(안전측)
    '남편',
    '배우자',
    '본인',
    '처',
    '아버지',
    '어머니',
  ]);
  if (banned.has(n)) return true;
  if (rel && n === rel) return true;
  return false;
}

/** 병렬 처리 최대 동시 요청 수 (환경변수로 조정 가능) */
const CONCURRENCY = parseInt(process.env.TYLIFE_CONCURRENCY ?? '5', 10);

function isTerminalContractStatus(status: string | null | undefined): boolean {
  return status === '가입' || status === '해약';
}

function isJoinEligibleByRule(params: {
  status: string | null | undefined;
  rental_request_no?: string | null;
  invoice_no?: string | null;
}): boolean {
  const status = params.status ?? '';
  if (status === '가입') return true;
  if (status === '해약') return false;
  return (params.rental_request_no ?? '').trim() !== '' && (params.invoice_no ?? '').trim() !== '';
}

function isEligibleForHqCustomerAttribution(params: {
  status: string | null | undefined;
  is_cancelled?: boolean | null;
  rental_request_no?: string | null;
  invoice_no?: string | null;
}): boolean {
  if (params.is_cancelled) return false;
  const status = (params.status ?? '').trim();
  if (status === '취소' || status === '해약') return false;
  return isJoinEligibleByRule({
    status,
    rental_request_no: params.rental_request_no,
    invoice_no: params.invoice_no,
  });
}

async function getHqMemberId(db: SupabaseClient): Promise<string | null> {
  // 호출 비용 절감 (동기화 동안 반복 조회 방지)
  if (getHqMemberId._cached !== undefined) return getHqMemberId._cached;

  // 프로젝트 규칙: 안성준을 본사로 취급 (organization/page.tsx와 동일 의도)
  const { data } = await db
    .from('organization_members')
    .select('id')
    .eq('name', '안성준')
    .limit(1)
    .maybeSingle();
  if (data) {
    getHqMemberId._cached = (data as { id: string }).id;
    return getHqMemberId._cached;
  }

  // fallback: rank='본사' 중 1개
  const { data: hq } = await db
    .from('organization_members')
    .select('id')
    .eq('rank', '본사')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  getHqMemberId._cached = hq ? (hq as { id: string }).id : null;
  return getHqMemberId._cached;
}

getHqMemberId._cached = undefined as undefined | string | null;

async function ensureOrgEdgeForceParentWithSource(
  db: SupabaseClient,
  parentId: string,
  childId: string,
  sourceContractId: string,
): Promise<void> {
  // 고객 노드 등 "본사 직속 보장" 케이스: 기존 parent가 있어도 강제로 parent를 맞춘다.
  const { data: edge, error } = await db
    .from('organization_edges')
    .upsert({ parent_id: parentId, child_id: childId }, { onConflict: 'child_id' })
    .select('id')
    .single();
  if (error) throw new Error(`organization_edges upsert 실패: ${error.message}`);

  const edgeId = (edge as { id: string }).id;
  await db.from('organization_edge_sources').upsert(
    { edge_id: edgeId, source_contract_id: sourceContractId, created_by: 'sync-service' },
    { onConflict: 'edge_id,source_contract_id' },
  );
}

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────

/**
 * items를 최대 limit개 동시 실행하며 순서대로 결과를 반환.
 */
async function runConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));

  async function worker() {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      results[next.i] = await fn(next.item);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ─────────────────────────────────────────────
// 로그 헬퍼 (에러/경고만 기록 — 건당 성공 로그 제거로 DB write 감소)
// ─────────────────────────────────────────────

async function log(
  db: SupabaseClient,
  runId: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  if (level === 'info') return; // info는 DB 기록 생략
  await db.from('sync_logs').insert({
    run_id: runId,
    level,
    message,
    context: context ?? null,
  });
}

// ─────────────────────────────────────────────
// Upsert 헬퍼
// ─────────────────────────────────────────────

async function upsertSalesMember(
  db: SupabaseClient,
  memberData: ReturnType<typeof normalizeSalesMember>,
): Promise<string | null> {
  if (!memberData.name) return null;

  if (memberData.external_id) {
    const { data, error } = await db
      .from('organization_members')
      .upsert(memberData, { onConflict: 'external_id' })
      .select('id')
      .single();
    if (error) throw new Error(`organization_members upsert 실패: ${error.message}`);
    return (data as { id: string }).id;
  }

  // external_id 없으면 이름으로 조회 후 없으면 insert
  const { data: existing } = await db
    .from('organization_members')
    .select('id')
    .eq('name', memberData.name)
    .limit(1)
    .maybeSingle();

  if (existing) return (existing as { id: string }).id;

  const { data, error } = await db
    .from('organization_members')
    .insert(memberData)
    .select('id')
    .single();
  if (error) throw new Error(`organization_members insert 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function upsertCustomer(
  db: SupabaseClient,
  customerData: NonNullable<ReturnType<typeof normalizeCustomerFromList>>,
): Promise<string> {
  const { data, error } = await db
    .from('customers')
    .upsert(customerData, { onConflict: 'ssn_masked' })
    .select('id')
    .single();
  if (error) throw new Error(`customers upsert 실패: ${error.message}`);
  return (data as { id: string }).id;
}

async function upsertContract(
  db: SupabaseClient,
  contractData: ContractInsert,
): Promise<{ id: string; isNew: boolean }> {
  const { data: existing } = await db
    .from('contracts')
    .select('id, status')
    .eq('contract_code', contractData.contract_code)
    .maybeSingle();

  const { data, error } = await db
    .from('contracts')
    .upsert(contractData, { onConflict: 'contract_code' })
    .select('id')
    .single();
  if (error) throw new Error(`contracts upsert 실패: ${error.message}`);

  const contractId = (data as { id: string }).id;
  const existingStatus = existing ? (existing as { status: string }).status : null;

  // 상태 변경 이력
  if (existingStatus && existingStatus !== contractData.status) {
    await db.from('contract_status_histories').insert({
      contract_id: contractId,
      from_status: existingStatus,
      to_status: contractData.status,
      changed_by: 'sync-service',
    });
  }

  return { id: contractId, isNew: !existing };
}

async function ensureOrgEdgeWithSource(
  db: SupabaseClient,
  parentId: string,
  childId: string,
  sourceContractId: string,
): Promise<void> {
  // child_id UNIQUE 제약: 이미 parent가 있으면 건드리지 않는다.
  const { data: existing, error: exErr } = await db
    .from('organization_edges')
    .select('id, parent_id')
    .eq('child_id', childId)
    .maybeSingle();
  if (exErr) throw new Error(`organization_edges 조회 실패: ${exErr.message}`);

  if (existing) {
    const ex = existing as { id: string; parent_id: string | null };
    if (ex.parent_id && ex.parent_id !== parentId) return;
    // parent가 null이거나 동일하면 그대로 사용
    const edgeId = ex.id;
    await db.from('organization_edge_sources').upsert(
      { edge_id: edgeId, source_contract_id: sourceContractId, created_by: 'sync-service' },
      { onConflict: 'edge_id,source_contract_id' },
    );
    return;
  }

  const { data: ins, error: insErr } = await db
    .from('organization_edges')
    .insert({ parent_id: parentId, child_id: childId })
    .select('id')
    .single();
  if (insErr) throw new Error(`organization_edges 생성 실패: ${insErr.message}`);
  const edgeId = (ins as { id: string }).id;
  await db.from('organization_edge_sources').upsert(
    { edge_id: edgeId, source_contract_id: sourceContractId, created_by: 'sync-service' },
    { onConflict: 'edge_id,source_contract_id' },
  );
}

// ─────────────────────────────────────────────
// 단일 계약 항목 처리
// ─────────────────────────────────────────────

async function processItem(
  db: SupabaseClient,
  runId: string,
  item: ParsedListItem,
  dryRun: boolean,
): Promise<'created' | 'updated' | 'error'> {
  try {
    if (dryRun) {
      await log(db, runId, 'info', `[dry-run] 파싱: ${item.contract_code}`, {
        customer: item.customer_name,
        external_id: item.external_id,
        snapshot_keys: Object.keys(item._snapshot),
      });
      return 'updated';
    }

    // ── 1. 고객 저장 ──
    const customerData = normalizeCustomerFromList(item);
    if (!customerData) {
      throw new Error(`SSN 파싱 실패 (ssn_masked: "${item.ssn_masked}")`);
    }
    const customerId = await upsertCustomer(db, customerData);

    // ── 2. 담당자:
    // - 이름이 DB에 1명 → 자동 연결
    // - 이름이 DB에 0명 → 자동 생성(직급은 소속/직책 문자열로 추론) 후 연결
    // - 동명이인(2명 이상) → 매핑 대기 (실적·정산 제외)
    const rawSalesName = item.sales_member_name?.trim() ?? null;
    let finalSalesMemberId: string | null = null;
    let salesLinkStatus: 'linked' | 'pending_mapping' = 'linked';
    let autoCreatedSalesMemberId: string | null = null;

    if (rawSalesName) {
      // 본사(안성준) 담당 계약은 항상 본사 id로 귀속되게 강제
      if (rawSalesName === '안성준') {
        const hqId = await getHqMemberId(db);
        finalSalesMemberId = hqId;
        salesLinkStatus = hqId ? 'linked' : 'pending_mapping';
      } else {
      const nameRes = await resolveSalesMemberByNameOnly(db, rawSalesName);
      if (nameRes.kind === 'single') {
        finalSalesMemberId = nameRes.memberId;
        salesLinkStatus = 'linked';
      } else if (nameRes.kind === 'missing') {
        // 조직도에 없는 이름이면 자동 생성 (동명이인 문제는 'ambiguous'에서만 처리)
        // 요구사항: “가입 인정 기준을 만족해 가입인 사람들만 영업사원 노드로 자동 생성”
        // → rank는 무조건 영업사원으로 생성한다.
        const memberData = {
          ...normalizeSalesMember({
          sales_member_name: rawSalesName,
          sales_member_external_id: null,
          org_rank: item.affiliation_name,
          }),
          rank: '영업사원' as const,
        };
        const createdId = await upsertSalesMember(db, memberData);
        finalSalesMemberId = createdId;
        autoCreatedSalesMemberId = createdId;
        salesLinkStatus = createdId ? 'linked' : 'pending_mapping';
      } else {
        finalSalesMemberId = null;
        salesLinkStatus = 'pending_mapping';
      }
      }
    }

    // ── 3. 기존 계약 조회 (상세 fetch 스킵 여부 + 실적 경로 1회 스탬핑 유지) ──
    const { data: existingContract } = await db
      .from('contracts')
      .select('id, status, unit_count, invoice_no, item_name, performance_path_json')
      .eq('contract_code', item.contract_code)
      .maybeSingle();

    const ec = existingContract as {
      status: string;
      unit_count: number | null;
      invoice_no: string | null;
      item_name: string | null;
      performance_path_json: unknown;
    } | null;
    const existingPathStamped = ec != null && ec.performance_path_json != null;
    const alreadyHasDetail =
      ec != null &&
      ec.status === normalizeStatus(item.status_raw ?? '') &&
      ec.unit_count != null &&
      ec.invoice_no != null &&
      ec.item_name != null &&
      ec.item_name !== DEFAULT_ITEM_NAME_PLACEHOLDER;

    // ── 4. 상세 HTML → TY Life external_id 로 담당자 확정 (동명이인/미매칭 해소)
    let detail: ReturnType<typeof parseContractDetailHtml> | null = null;
    // 성능 최적화(캐싱):
    // - status가 '가입'/'해약'인 계약은 상세 재조회 비용 대비 이득이 낮아 “박제”로 취급하고 더 이상 상세 fetch 하지 않는다.
    // - 이미 DB에 '가입'/'해약'으로 저장된 계약도 동일하게 스킵한다.
    const listStatus = normalizeStatus(item.status_raw ?? '');
    const skipDetailFetch = isTerminalContractStatus(listStatus) || isTerminalContractStatus(ec?.status ?? null);

    if (item.external_id && !alreadyHasDetail && !skipDetailFetch) {
      try {
        let html = await fetchContractDetailHtml(item.external_id);
        // 상세 URL id vs HTML 내부 contractNo 불일치 케이스 보정 (backfill과 동일 정책)
        const m = html.match(/contractNo\s*[:=]\s*['"]?(\d+)/i);
        if (m?.[1] && m[1] !== item.external_id) {
          html = await fetchContractDetailHtml(m[1]);
        }
        detail = parseContractDetailHtml(html, item.contract_code);

        if (detail.sales_member_external_id) {
          const memberData = normalizeSalesMember({
            sales_member_name: item.sales_member_name?.trim() || '담당',
            sales_member_external_id: detail.sales_member_external_id,
            org_rank: item.affiliation_name,
          });
          const extSalesId = await upsertSalesMember(db, memberData);
          if (extSalesId) {
            finalSalesMemberId = extSalesId;
            salesLinkStatus = 'linked';
          }
        }
      } catch (detailErr) {
        const msg = detailErr instanceof Error ? detailErr.message : String(detailErr);
        await log(db, runId, 'warn', `상세 fetch 실패 (리스트 데이터로 저장): ${item.contract_code}`, {
          external_id: item.external_id,
          error: msg,
        });
      }
    }

    if (salesLinkStatus === 'pending_mapping') {
      finalSalesMemberId = null;
    }

    const contractBase = normalizeContractFromList(item, customerId, finalSalesMemberId);
    let contractFinal: ContractInsert = {
      ...contractBase,
      source_snapshot_json: item._snapshot,
      sales_link_status: salesLinkStatus,
      raw_sales_member_name: salesLinkStatus === 'pending_mapping' ? rawSalesName : null,
      performance_path_json: null,
    };

    if (detail) {
      contractFinal = {
        ...mergeDetailIntoContract(contractBase, detail),
        source_snapshot_json: item._snapshot,
        sales_member_id: finalSalesMemberId,
        sales_link_status: salesLinkStatus,
        raw_sales_member_name: salesLinkStatus === 'pending_mapping' ? rawSalesName : null,
        performance_path_json: null,
      };
    }

    // ── 상태 정규화(가입 인정 기준) ──
    // 원본 status가 '대기/준비/...'여도, 해약이 아니고 송장+렌탈이 있으면 "가입"으로 본다.
    // 이렇게 DB에 저장되는 status 자체를 통일하면, /organization 예외/집계가 동기화 타이밍에 흔들리지 않는다.
    if (isJoinEligibleByRule({
      status: contractFinal.status,
      rental_request_no: contractFinal.rental_request_no,
      invoice_no: contractFinal.invoice_no,
    })) {
      contractFinal = { ...contractFinal, status: '가입' };
    }

    // ── 5. 실적 스탬핑: 최초 1회만 경로 박제 (이후 조직 개편·퇴사에도 당시 레그 유지)
    if (salesLinkStatus === 'linked' && finalSalesMemberId && !existingPathStamped) {
      const path = await buildPerformancePath(db, finalSalesMemberId);
      contractFinal = {
        ...contractFinal,
        sales_member_id: finalSalesMemberId,
        performance_path_json: path,
        sales_link_status: 'linked',
        raw_sales_member_name: null,
      };
    } else if (salesLinkStatus === 'linked' && finalSalesMemberId && existingPathStamped) {
      contractFinal = {
        ...contractFinal,
        sales_member_id: finalSalesMemberId,
        sales_link_status: 'linked',
        raw_sales_member_name: null,
      };
    }

    // upsert 시 누락 필드가 NULL로 덮이지 않도록, 이미 박제된 실적 경로는 유지
    if (existingPathStamped && ec?.performance_path_json != null) {
      contractFinal = {
        ...contractFinal,
        performance_path_json: ec.performance_path_json as ContractInsert['performance_path_json'],
      };
    }

    const { id: contractId, isNew } = await upsertContract(db, contractFinal);

    // ── 4.5. 본사(안성준) 아래 영업사원 노드 자동 편입 ──
    // 조건:
    // - 담당자명이 DB에 없어서 새로 생성된 영업사원(autoCreatedSalesMemberId)
    // - 가입 인정 기준을 만족하는 계약만
    // - linked 상태만
    if (autoCreatedSalesMemberId && salesLinkStatus === 'linked') {
      const eligible = isJoinEligibleByRule({
        status: contractFinal.status,
        rental_request_no: contractFinal.rental_request_no,
        invoice_no: contractFinal.invoice_no,
      });
      if (eligible) {
        const hqId = await getHqMemberId(db);
        if (hqId) {
          await ensureOrgEdgeWithSource(db, hqId, autoCreatedSalesMemberId, contractId);
        }
      }
    }

    // ── 4.6. 본사(안성준) 담당 + 가입 인정 고객을 "본사 직속" 노드로 보장 ──
    // 요구사항:
    // - sales_member_id가 안성준(본사)이고, 가입 인정 기준을 만족하면
    //   고객을 organization_members(영업사원)로 생성/재사용하고,
    //   organization_edges에서 안성준(본사) 아래로 직접 연결을 보장한다.
    if (salesLinkStatus === 'linked') {
      const hqId = await getHqMemberId(db);
      const isHqSales = hqId != null && finalSalesMemberId === hqId;
      const eligible = isEligibleForHqCustomerAttribution({
        status: contractFinal.status,
        is_cancelled: (contractFinal as any).is_cancelled ?? null,
        rental_request_no: contractFinal.rental_request_no,
        invoice_no: contractFinal.invoice_no,
      });
      if (isHqSales && eligible) {
        const customerNodeName = (item.customer_name ?? '').trim();
        if (customerNodeName) {
          // 고객을 조직원으로 "가상" 등록: external_id로 고객ID 기반 고유키 사용 (이름 중복과 무관)
          // UI에서 실제 영업사원과 혼동되지 않도록 접두어 부여
          const displayName = customerNodeName.startsWith('[고객] ')
            ? customerNodeName
            : `[고객] ${customerNodeName}`;
          const customerSalesMemberId = await upsertSalesMember(db, {
            name: displayName,
            rank: '영업사원',
            external_id: `customer:${customerId}`,
            phone: (customerData as any).phone ?? null,
            is_active: true,
          } as any);

          if (customerSalesMemberId) {
            await ensureOrgEdgeForceParentWithSource(db, hqId, customerSalesMemberId, contractId);
          }
        }
      }
    }

    // ── 6. 신규 영업사원 편입(추천 트리): A(판매자) 아래에 B(계약자=내부 영업사원) 붙이기
    // 조건:
    // - 상세에서 contractor_name이 있고
    // - parent A(=finalSalesMemberId)가 확정(linked)이며
    // - contractor_name이 organization_members에 유일하게 매칭되거나(0명은 신규 생성), 동명이인은 pending으로 분리
    if (detail && salesLinkStatus === 'linked' && finalSalesMemberId) {
      const contractorName = detail.contractor_name?.trim() ?? '';
      const rel = detail.relationship_to_contractor?.trim() ?? '';
      const customerName = item.customer_name?.trim() ?? '';
      if (
        contractorName &&
        contractorName !== customerName &&
        !shouldExcludeRecruitmentName(contractorName, rel)
      ) {
        const res = await resolveContractorByNameOnly(db, contractorName);

        if (res.kind === 'single') {
          await db
            .from('contracts')
            .update({
              contractor_member_id: res.memberId,
              contractor_link_status: 'linked',
              contractor_candidates_json: null,
            })
            .eq('id', contractId);
          await ensureOrgEdgeWithSource(db, finalSalesMemberId, res.memberId, contractId);
        } else if (res.kind === 'missing') {
          // 중요: 영업사원(organization_members) 신규 생성은 "담당자명"에서만 허용.
          // 계약자/관계 필드에서 나온 이름으로는 절대 자동 생성하지 않는다.
          await db
            .from('contracts')
            .update({
              contractor_member_id: null,
              contractor_link_status: 'pending_mapping',
              contractor_candidates_json: { name: contractorName, candidate_ids: [] },
            })
            .eq('id', contractId);
        } else {
          await db
            .from('contracts')
            .update({
              contractor_member_id: null,
              contractor_link_status: 'pending_mapping',
              contractor_candidates_json: { name: contractorName, candidate_ids: res.ids },
            })
            .eq('id', contractId);
        }
      } else if (contractorName) {
        // 관계값/무효값으로 판단되면 편입 로직 제외(큐에도 올리지 않음)
        await db
          .from('contracts')
          .update({
            contractor_member_id: null,
            contractor_link_status: 'not_internal',
            contractor_candidates_json: null,
          })
          .eq('id', contractId);
      }
    }
    return isNew ? 'created' : 'updated';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, runId, 'error', `계약 처리 실패: ${item.contract_code}`, {
      external_id: item.external_id,
      error: message,
    });
    return 'error';
  }
}

// ─────────────────────────────────────────────
// 단일 페이지 동기화
// ─────────────────────────────────────────────

export interface SyncPageOptions {
  rowPerPage?: number;
  dryRun?: boolean;
}

export interface SyncPageResult {
  page: number;
  fetched: number;
  created: number;
  updated: number;
  errors: number;
  /** 다음 페이지가 있을 가능성 (fetched === rowPerPage) */
  hasMore: boolean;
}

/**
 * 지정 페이지 1개만 동기화.
 * runId가 있으면 해당 sync_run에 로그 기록.
 * 없으면 독립 실행용 임시 runId 생성.
 */
export async function syncContractPage(
  page: number,
  opts: SyncPageOptions = {},
  runId?: string,
): Promise<SyncPageResult> {
  const { rowPerPage = 50, dryRun = false } = opts;
  const db = createAdminSupabaseClient();

  // 독립 실행 시 임시 sync_run 생성
  let ownRunId = runId;
  if (!ownRunId) {
    const { data } = await db
      .from('sync_runs')
      .insert({ status: 'running', triggered_by: `manual-page-${page}` })
      .select('id')
      .single();
    ownRunId = (data as SyncRun).id;
  }

  const apiRes = await fetchContractList(page, rowPerPage);
  const listHtml = apiRes.data?.listHtml ?? '';
  const items = parseContractListHtml(listHtml);

  let created = 0;
  let updated = 0;
  let errors = 0;

  const results = await runConcurrent(items, CONCURRENCY, (item) =>
    processItem(db, ownRunId, item, dryRun),
  );

  for (const result of results) {
    if (result === 'created') created++;
    else if (result === 'updated') updated++;
    else errors++;
  }

  // 독립 실행이면 sync_run 완료 처리
  if (!runId) {
    await db
      .from('sync_runs')
      .update({
        status: errors === items.length && items.length > 0 ? 'failed' : 'completed',
        finished_at: new Date().toISOString(),
        total_fetched: items.length,
        total_created: created,
        total_updated: updated,
        total_errors: errors,
      })
      .eq('id', ownRunId);
  }

  return {
    page,
    fetched: items.length,
    created,
    updated,
    errors,
    hasMore: items.length >= rowPerPage,
  };
}

// ─────────────────────────────────────────────
// 전체 동기화 (syncContractPage 반복)
// ─────────────────────────────────────────────

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const {
    triggeredBy = 'manual',
    rowPerPage = 50,
    maxPage,
    dryRun = false,
  } = options;

  const db = createAdminSupabaseClient();
  const startedAt = Date.now();

  const { data: runData, error: runError } = await db
    .from('sync_runs')
    .insert({ status: 'running', triggered_by: triggeredBy })
    .select('id')
    .single();

  if (runError || !runData) {
    throw new Error(`sync_runs 생성 실패: ${runError?.message}`);
  }

  const runId = (runData as SyncRun).id;
  let totalFetched = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  try {
    await log(db, runId, 'info', `동기화 시작${dryRun ? ' [dry-run]' : ''}`, {
      row_per_page: rowPerPage,
      max_page: maxPage ?? 'unlimited',
    });

    let page = 1;

    while (true) {
      if (maxPage && page > maxPage) break;

      console.log(`[sync] 페이지 ${page} 처리 중...`);

      const pageResult = await syncContractPage(
        page,
        { rowPerPage, dryRun },
        runId,
      );

      totalFetched += pageResult.fetched;
      totalCreated += pageResult.created;
      totalUpdated += pageResult.updated;
      totalErrors += pageResult.errors;

      await log(db, runId, 'info', `페이지 ${page} 완료`, {
        fetched: pageResult.fetched,
        created: pageResult.created,
        updated: pageResult.updated,
        errors: pageResult.errors,
      });

      if (!pageResult.hasMore) break;
      page++;
    }

    await db
      .from('sync_runs')
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        total_fetched: totalFetched,
        total_created: totalCreated,
        total_updated: totalUpdated,
        total_errors: totalErrors,
      })
      .eq('id', runId);

    await log(db, runId, 'info', '동기화 완료', {
      total_fetched: totalFetched,
      total_created: totalCreated,
      total_updated: totalUpdated,
      total_errors: totalErrors,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .from('sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        total_fetched: totalFetched,
        total_created: totalCreated,
        total_updated: totalUpdated,
        total_errors: totalErrors + 1,
      })
      .eq('id', runId);
    await log(db, runId, 'error', `동기화 실패: ${message}`);
    throw err;
  }

  return {
    run_id: runId,
    status: 'completed',
    total_fetched: totalFetched,
    total_created: totalCreated,
    total_updated: totalUpdated,
    total_errors: totalErrors,
    duration_ms: Date.now() - startedAt,
  };
}
