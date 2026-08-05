/**
 * TY Life 송장번호 placeholder 정규화.
 * '-', '[-]', '- [-]' 등 대시·괄호만 있는 값은 송장 없음(NULL)으로 처리한다.
 */

export type InvoiceJoinProductRef = {
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

/** 대시·공백·괄호만으로 구성된 placeholder 여부 */
export function isInvoiceNoPlaceholder(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return /^[-\s\[\]]+$/.test(t);
}

/** DB·동기화 저장용: 유효 송장번호 또는 null */
export function normalizeInvoiceNo(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!t || isInvoiceNoPlaceholder(t)) return null;
  return t;
}

/** 정산·가입 인정 판정용 (상품 무관 기본: 비어있지 않은 송장) */
export function hasValidInvoiceNo(raw: string | null | undefined): boolean {
  return normalizeInvoiceNo(raw) != null;
}

/** 숫자(송장번호)가 포함된 송장 */
export function hasNumericInvoiceNo(raw: string | null | undefined): boolean {
  const n = normalizeInvoiceNo(raw);
  return n != null && /\d/.test(n);
}

/** TY스페셜라이프케어 설치완료 마커 송장 */
export function hasSpecialLifeCareInstallCompleteInvoice(
  raw: string | null | undefined,
): boolean {
  const n = normalizeInvoiceNo(raw);
  return n != null && n.includes('설치완료');
}

function collectProductTexts(product?: InvoiceJoinProductRef | null): string[] {
  if (!product) return [];
  return [product.product_type, product.item_name, product.source_snapshot_json?.['상품명']]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);
}

/** TY스페셜라이프케어(레거시 일반가전·스페셜라이프케어 포함) */
export function isTySpecialLifeCareProduct(product?: InvoiceJoinProductRef | null): boolean {
  return collectProductTexts(product).some(
    (t) => t.includes('스페셜라이프케어') || t.includes('일반가전'),
  );
}

/**
 * 가입 인정용 송장 충족 여부.
 * - TY스페셜라이프케어: 숫자 송장 또는 송장에 '설치완료' 포함
 * - 그 외: 기존과 동일하게 유효 송장번호 존재
 */
export function hasJoinSatisfyingInvoiceNo(
  invoiceNo: string | null | undefined,
  product?: InvoiceJoinProductRef | null,
): boolean {
  if (isTySpecialLifeCareProduct(product)) {
    return hasNumericInvoiceNo(invoiceNo) || hasSpecialLifeCareInstallCompleteInvoice(invoiceNo);
  }
  return hasValidInvoiceNo(invoiceNo);
}
