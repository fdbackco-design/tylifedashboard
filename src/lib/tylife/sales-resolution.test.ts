import { describe, expect, it, vi } from 'vitest';
import { resolveSalesMemberByNameOnly } from './sales-resolution';

function mockDb(rows: Array<{ id: string; external_id: string | null; source_customer_id: string | null }>) {
  const activeEq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const nameEq = vi.fn().mockReturnValue({ eq: activeEq });
  const select = vi.fn().mockReturnValue({ eq: nameEq });
  return { from: vi.fn().mockReturnValue({ select }) };
}

describe('resolveSalesMemberByNameOnly', () => {
  it('동명이인 customer:* 노드를 담당자로 확정하지 않는다', async () => {
    const db = mockDb([
      {
        id: 'customer-kim',
        external_id: 'customer:d3e50cec-8c23-4d46-a851-998719e0e331',
        source_customer_id: 'd3e50cec-8c23-4d46-a851-998719e0e331',
      },
    ]);

    await expect(resolveSalesMemberByNameOnly(db as never, '김혜현')).resolves.toEqual({ kind: 'missing' });
  });

  it('customer:*와 실제 영업자가 함께 있으면 영업자만 선택한다', async () => {
    const db = mockDb([
      {
        id: 'customer-kim',
        external_id: 'customer:d3e50cec-8c23-4d46-a851-998719e0e331',
        source_customer_id: 'd3e50cec-8c23-4d46-a851-998719e0e331',
      },
      { id: 'sales-kim', external_id: null, source_customer_id: null },
    ]);

    await expect(resolveSalesMemberByNameOnly(db as never, '김혜현')).resolves.toEqual({
      kind: 'single',
      memberId: 'sales-kim',
    });
  });

  it('실제 영업자 후보가 여러 명이면 자동 연결하지 않는다', async () => {
    const db = mockDb([
      { id: 'sales-kim-1', external_id: null, source_customer_id: null },
      { id: 'sales-kim-2', external_id: 'ty:sales-kim-2', source_customer_id: null },
    ]);

    await expect(resolveSalesMemberByNameOnly(db as never, '김혜현')).resolves.toEqual({
      kind: 'ambiguous',
      ids: ['sales-kim-1', 'sales-kim-2'],
    });
  });
});
