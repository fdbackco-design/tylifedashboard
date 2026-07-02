/**
 * TY Life 송장번호 placeholder 정규화.
 * '-', '[-]', '- [-]' 등 대시·괄호만 있는 값은 송장 없음(NULL)으로 처리한다.
 */

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

/** 정산·가입 인정 판정용 */
export function hasValidInvoiceNo(raw: string | null | undefined): boolean {
  return normalizeInvoiceNo(raw) != null;
}
