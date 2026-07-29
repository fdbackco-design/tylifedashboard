import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isValid8Digits, isValidAccountLoginCode } from './issue';

describe('account issue login code validation', () => {
  it('기존 8자리 숫자 계정을 계속 허용한다', () => {
    expect(isValid8Digits('12345678')).toBe(true);
    expect(isValidAccountLoginCode('12345678')).toBe(true);
  });

  it('신규 fed+8자리 사원ID를 허용한다', () => {
    expect(isValidAccountLoginCode('fed12345678')).toBe(true);
    expect(isValidAccountLoginCode('FED12345678')).toBe(true);
  });

  it('잘못된 사원ID를 거부한다', () => {
    expect(isValidAccountLoginCode('fed1234')).toBe(false);
    expect(isValidAccountLoginCode('abc12345678')).toBe(false);
    expect(isValidAccountLoginCode('01012345678')).toBe(false);
  });
});
