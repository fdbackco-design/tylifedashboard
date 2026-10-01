import { describe, expect, it } from 'vitest';
import { extractAccountLoginCode, loginCodeLookupCandidates, passwordFromPhoneLast8 } from './login-code';

describe('extractAccountLoginCode', () => {
  it('기존 8자리와 fed+8자리를 모두 인식한다', () => {
    expect(extractAccountLoginCode('26984730')).toBe('26984730');
    expect(extractAccountLoginCode('fed68761290')).toBe('fed68761290');
    expect(extractAccountLoginCode('FED68761290')).toBe('fed68761290');
    expect(extractAccountLoginCode('fed68761290@tylifedashboard.local')).toBe('fed68761290');
  });

  it('숫자를 잘라 fed 접두사를 버리지 않는다', () => {
    expect(extractAccountLoginCode('fed68761290')?.replace(/\D/g, '')).toBe('68761290');
    expect(extractAccountLoginCode('fed68761290')).not.toBe('68761290');
  });

  it('잘못된 값을 거부한다', () => {
    expect(extractAccountLoginCode('fed1234')).toBeNull();
    expect(extractAccountLoginCode('01068761290')).toBeNull();
    expect(extractAccountLoginCode('')).toBeNull();
  });
});

describe('loginCodeLookupCandidates', () => {
  it('8자리 입력은 fed 계정도 이어서 찾는다', () => {
    expect(loginCodeLookupCandidates('68761290')).toEqual(['68761290', 'fed68761290']);
  });

  it('fed 입력은 그 값만 조회한다', () => {
    expect(loginCodeLookupCandidates('fed68761290')).toEqual(['fed68761290']);
  });
});

describe('passwordFromPhoneLast8', () => {
  it('휴대폰 010을 빼고 뒤 8자리를 비밀번호로 쓴다', () => {
    expect(passwordFromPhoneLast8('fed68761290', '010-6876-1290')).toBe('68761290');
    expect(passwordFromPhoneLast8('26984730', '010-2698-4730')).toBe('26984730');
  });

  it('전화번호가 없어도 fed 로그인 ID의 숫자 8자리를 쓴다', () => {
    expect(passwordFromPhoneLast8('fed68761290', null)).toBe('68761290');
  });
});
