import { describe, expect, it } from 'vitest';
import { mappedAccountMatchesSelfContract } from './self-contract-sales';

describe('mappedAccountMatchesSelfContract', () => {
  it('계정과 고객의 이름·전화번호가 같으면 동일인으로 판단한다', () => {
    expect(
      mappedAccountMatchesSelfContract(
        {
          display_name: '조이찬',
          pre_issued_name: '조이찬',
          phone: '01075442089',
          pre_issued_phone: '01075442089',
        },
        { name: '조이찬', phone: '010-7544-2089' },
      ),
    ).toBe(true);
  });

  it('동명이지만 전화번호가 다르면 동일인으로 판단하지 않는다', () => {
    expect(
      mappedAccountMatchesSelfContract(
        {
          display_name: '김혜현',
          pre_issued_name: '김혜현',
          phone: '01059584998',
          pre_issued_phone: '01059584998',
        },
        { name: '김혜현', phone: '01092337897' },
      ),
    ).toBe(false);
  });
});
