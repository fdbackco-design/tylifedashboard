import { isTyGalaxyCareMuContract } from '@/lib/settlement/galaxy-care-mu';

export type ContractDisplayProductInput = {
  product_type?: string | null;
  item_name?: string | null;
  source_snapshot_json?: Record<string, string | null> | null;
};

/**
 * 화면 표시용 상품명.
 * TY갤럭시케어_무 / product_type=무 등은 TY갤럭시케어로 통일한다.
 */
export function getContractDisplayProductName(c: ContractDisplayProductInput): string {
  if (isTyGalaxyCareMuContract(c)) {
    return 'TY갤럭시케어';
  }

  const texts = [c.product_type, c.source_snapshot_json?.['상품명']]
    .map((t) => String(t ?? '').trim())
    .filter(Boolean);

  for (const text of texts) {
    if (text.includes('TY갤럭시케어_무') || text.includes('TY갤럭시케어_ALL')) {
      return 'TY갤럭시케어';
    }
    if (text.includes('TY갤럭시케어')) {
      return 'TY갤럭시케어';
    }
  }

  const productType = String(c.product_type ?? '').trim();
  return productType || '-';
}
