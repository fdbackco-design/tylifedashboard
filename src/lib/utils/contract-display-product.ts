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

  const snapshotProduct = String(c.source_snapshot_json?.['상품명'] ?? '').trim();
  if (snapshotProduct) {
    // 화면에는 스크래핑 원본 '상품명'을 우선 노출한다 (정규화/레거시 매핑보다 신뢰도가 높음).
    // 단, 갤럭시케어 계열의 _무/_ALL 은 화면 표기를 TY갤럭시케어로 통일한다.
    if (snapshotProduct.includes('TY갤럭시케어_무') || snapshotProduct.includes('TY갤럭시케어_ALL')) {
      return 'TY갤럭시케어';
    }
    return snapshotProduct;
  }

  const texts = [c.product_type]
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
