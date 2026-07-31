import { describe, expect, it, vi } from 'vitest';
import { resolveSalesMemberByNameOnly } from './sales-resolution';

type MemberRow = {
  id: string;
  name: string;
  phone: string | null;
  external_id: string | null;
  source_customer_id: string | null;
};

type ProfileRow = {
  member_id: string;
  display_name: string;
  pre_issued_name: string | null;
  phone: string;
  pre_issued_phone: string | null;
};

function mockDb(rows: MemberRow[], profiles: ProfileRow[] = []) {
  const activeEq = vi.fn().mockResolvedValue({ data: rows, error: null });
  const nameEq = vi.fn().mockReturnValue({ eq: activeEq });
  const memberSelect = vi.fn().mockReturnValue({ eq: nameEq });

  const profileActiveEq = vi.fn().mockResolvedValue({ data: profiles, error: null });
  const profileRoleEq = vi.fn().mockReturnValue({ eq: profileActiveEq });
  const profileIn = vi.fn().mockReturnValue({ eq: profileRoleEq });
  const profileSelect = vi.fn().mockReturnValue({ in: profileIn });

  return {
    from: vi.fn((table: string) => ({
      select: table === 'user_profiles' ? profileSelect : memberSelect,
    })),
  };
}

describe('resolveSalesMemberByNameOnly', () => {
  it('동명이인 customer:* 노드를 담당자로 확정하지 않는다', async () => {
    const db = mockDb([
      {
        id: 'customer-kim',
        name: '김혜현',
        phone: '01092337897',
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
        name: '김혜현',
        phone: '01092337897',
        external_id: 'customer:d3e50cec-8c23-4d46-a851-998719e0e331',
        source_customer_id: 'd3e50cec-8c23-4d46-a851-998719e0e331',
      },
      { id: 'sales-kim', name: '김혜현', phone: '01059584998', external_id: null, source_customer_id: null },
    ]);

    await expect(resolveSalesMemberByNameOnly(db as never, '김혜현')).resolves.toEqual({
      kind: 'single',
      memberId: 'sales-kim',
    });
  });

  it('실제 영업자 후보가 여러 명이면 자동 연결하지 않는다', async () => {
    const db = mockDb([
      { id: 'sales-kim-1', name: '김혜현', phone: null, external_id: null, source_customer_id: null },
      { id: 'sales-kim-2', name: '김혜현', phone: null, external_id: 'ty:sales-kim-2', source_customer_id: null },
    ]);

    await expect(resolveSalesMemberByNameOnly(db as never, '김혜현')).resolves.toEqual({
      kind: 'ambiguous',
      ids: ['sales-kim-1', 'sales-kim-2'],
    });
  });

  it('customer:* 노드라도 일치하는 활성 계정이 있으면 담당자로 선택한다', async () => {
    const memberId = 'customer-jo';
    const db = mockDb(
      [
        {
          id: memberId,
          name: '조이찬',
          phone: '01075442089',
          external_id: 'customer:e59dcbb4-e422-4bbc-bad7-6cfa88c86d1f',
          source_customer_id: 'e59dcbb4-e422-4bbc-bad7-6cfa88c86d1f',
        },
      ],
      [
        {
          member_id: memberId,
          display_name: '조이찬',
          pre_issued_name: '조이찬',
          phone: '01075442089',
          pre_issued_phone: '01075442089',
        },
      ],
    );

    await expect(resolveSalesMemberByNameOnly(db as never, '조이찬')).resolves.toEqual({
      kind: 'single',
      memberId,
    });
  });

  it('customer:* 노드 계정의 전화번호가 다르면 담당자로 선택하지 않는다', async () => {
    const memberId = 'customer-kim';
    const db = mockDb(
      [
        {
          id: memberId,
          name: '김혜현',
          phone: '01092337897',
          external_id: 'customer:d3e50cec-8c23-4d46-a851-998719e0e331',
          source_customer_id: 'd3e50cec-8c23-4d46-a851-998719e0e331',
        },
      ],
      [
        {
          member_id: memberId,
          display_name: '김혜현',
          pre_issued_name: '김혜현',
          phone: '01059584998',
          pre_issued_phone: '01059584998',
        },
      ],
    );

    await expect(resolveSalesMemberByNameOnly(db as never, '김혜현')).resolves.toEqual({
      kind: 'missing',
    });
  });
});
