import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { resetMemberPasswordToLoginCode } from './reset-password';

function mockAdminDb(profiles: Array<{ id: string; login_code: string; display_name: string | null; phone: string | null }>) {
  const updated: Array<{ table: string; payload: unknown }> = [];
  return {
    updated,
    client: {
      from(table: string) {
        return {
          select() {
            return {
              in(_column: string, codes: string[]) {
                return Promise.resolve({
                  data: profiles.filter((row) => codes.includes(row.login_code)),
                  error: null,
                });
              },
            };
          },
          update(payload: unknown) {
            updated.push({ table, payload });
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(payload: unknown) {
            updated.push({ table, payload });
            return Promise.resolve({ error: null });
          },
        };
      },
      auth: {
        admin: {
          updateUserById(_id: string, payload: { password: string }) {
            updated.push({ table: 'auth', payload });
            return Promise.resolve({ error: null });
          },
        },
      },
    },
  };
}

describe('resetMemberPasswordToLoginCode', () => {
  it('fed 계정은 휴대폰 010 제외 8자리로 초기화한다', async () => {
    const db = mockAdminDb([
      {
        id: 'user-1',
        login_code: 'fed68761290',
        display_name: '김수정',
        phone: '010-6876-1290',
      },
    ]);
    const result = await resetMemberPasswordToLoginCode(db.client as never, 'fed68761290');
    expect(result).toMatchObject({
      ok: true,
      login_code: 'fed68761290',
      password_hint: '68761290',
    });
    expect(db.updated.find((row) => row.table === 'auth')?.payload).toEqual({ password: '68761290' });
  });

  it('8자리만 입력해도 fed 계정을 찾아 뒤 8자리로 초기화한다', async () => {
    const db = mockAdminDb([
      {
        id: 'user-1',
        login_code: 'fed68761290',
        display_name: '김수정',
        phone: '01068761290',
      },
    ]);
    const result = await resetMemberPasswordToLoginCode(db.client as never, '68761290');
    expect(result).toMatchObject({
      ok: true,
      login_code: 'fed68761290',
      password_hint: '68761290',
    });
  });
});
