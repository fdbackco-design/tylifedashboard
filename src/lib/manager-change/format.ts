/**
 * 담당자 변경 신청 공통 유틸.
 */

export const MANAGER_CHANGE_BRANCH_NAME = 'Ty Life Partners';

export function formatPhoneDisplay(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d;
}

export function managerChangeStatusLabel(status: string): string {
  if (status === 'COMPLETED') return '완료';
  if (status === 'PENDING') return '신청중';
  return status;
}

export function formatManagerChangeCodesLine(contractCodes: string, itemName: string): string {
  const codes = (contractCodes ?? '').trim();
  const item = (itemName ?? '').trim();
  if (!codes) return item;
  if (!item) return codes;
  return `${codes} / ${item}`;
}

export function fmtDateTimeSeoul(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
