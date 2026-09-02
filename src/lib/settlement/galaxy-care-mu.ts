const MU_VALID_HAPPYCALL_RESULTS: ReadonlySet<string> = new Set([
  '성공',
  '완료',
  '심사완료',
  '계약변경',
]);

function happycallYmdLocal(ts: unknown): string {
  if (ts == null) return '';
  if (typeof ts === 'string') {
    const t = ts.trim();
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    }
    return t.slice(0, 10);
  }
  if (ts instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ts);
  }
  return '';
}

export type GalaxyCareMuDetectInput = {
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

function collectProductDetectTexts(c: GalaxyCareMuDetectInput): string[] {
  return [
    c.product_type,
    c.item_name,
    c.source_snapshot_json?.['상품명'],
  ]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
}

/** TY올라이프케어 / TY올라이프케어_무 / 레거시 올라이프케어 */
export function isAllLifeCareContract(c: GalaxyCareMuDetectInput): boolean {
  return collectProductDetectTexts(c).some((t) => t.includes('올라이프케어'));
}

/** TY갤럭시케어_무: 렌탈·송장 없이 해피콜 완료만으로 가입 인정 */
export function isTyGalaxyCareMuContract(c: GalaxyCareMuDetectInput): boolean {
  // TY올라이프케어_무 는 갤럭시무가 아니라 올라이프케어와 동일 취급
  if (isAllLifeCareContract(c)) return false;

  const productType = (c.product_type ?? '').trim();
  if (productType === '무') return true;

  const texts = collectProductDetectTexts(c);
  return texts.some((t) => t.includes('TY갤럭시케어_무'));
}

/** TY케어플랜: 렌탈·송장 없이 해피콜 성공만으로 가입 인정 (가입일=해피콜 성공일) */
export function isTyCarePlanContract(c: GalaxyCareMuDetectInput): boolean {
  const productType = (c.product_type ?? '').trim();
  if (productType === 'TY케어플랜') return true;
  return collectProductDetectTexts(c).some((t) => t.includes('TY케어플랜') || t === '케어플랜');
}

/** 송장·렌탈 없이 해피콜만으로 가입 인정하는 상품 (갤럭시무 · TY케어플랜) */
export function isInvoiceExemptHappyCallJoinContract(c: GalaxyCareMuDetectInput): boolean {
  return isTyGalaxyCareMuContract(c) || isTyCarePlanContract(c);
}

/**
 * 해피콜 일시·결과 정규화.
 * - happycall_result 컬럼 우선
 * - 없으면 happy_call_at 문자열 꼬리("2026-06-29 성공")에서 결과 추출
 */
export function resolveHappycallEligibilityFields(
  happy_call_at: unknown,
  happycall_result: string | null | undefined,
): { ymd: string; result: string } {
  const resultCol = String(happycall_result ?? '').trim();

  if (typeof happy_call_at === 'string') {
    const raw = happy_call_at.trim();
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(.+))?$/);
    if (m) {
      return {
        ymd: m[1],
        result: resultCol || (m[2] ?? '').trim(),
      };
    }
  }

  return {
    ymd: happycallYmdLocal(happy_call_at),
    result: resultCol,
  };
}

export function meetsTyGalaxyCareMuJoinCondition(params: {
  happy_call_at?: unknown;
  happycall_result?: string | null;
  is_cancelled?: boolean | null;
}): boolean {
  if (params.is_cancelled) return false;
  const { ymd, result } = resolveHappycallEligibilityFields(
    params.happy_call_at,
    params.happycall_result,
  );
  if (!ymd) return false;
  return MU_VALID_HAPPYCALL_RESULTS.has(result);
}

/** 송장 면제 상품 공통 가입 조건 (해피콜 성공일·결과) */
export const meetsInvoiceExemptHappyCallJoinCondition = meetsTyGalaxyCareMuJoinCondition;
