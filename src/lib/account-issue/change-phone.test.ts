import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { deriveCredentialsFromPhone } from './change-phone';

describe('deriveCredentialsFromPhone', () => {
  it('기존 8자리 계정은 뒤 8자리를 로그인 ID·비밀번호로 쓴다', () => {
    expect(deriveCredentialsFromPhone('010-4311-4386', '12345678')).toEqual({
      phoneDigits: '01043114386',
      loginCode: '43114386',
      password: '43114386',
      email: '43114386@tylifedashboard.local',
    });
  });

  it('fed 계정은 fed+뒤8자리 로그인 ID와 전체 휴대폰 숫자를 비밀번호로 쓴다', () => {
    expect(deriveCredentialsFromPhone('01043114386', 'fed04311438')).toEqual({
      phoneDigits: '01043114386',
      loginCode: 'fed43114386',
      password: '01043114386',
      email: 'fed43114386@tylifedashboard.local',
    });
  });

  it('잘못된 전화번호를 거부한다', () => {
    expect(deriveCredentialsFromPhone('43114386', '12345678')).toBeNull();
    expect(deriveCredentialsFromPhone('010-123', 'fed12345678')).toBeNull();
  });
});
