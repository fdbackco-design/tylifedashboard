import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Admin 로그인' };

export default function AdminLoginPage({ searchParams }: { searchParams?: { error?: string } }) {
  const error = searchParams?.error;

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Admin 로그인</h1>
        <p className="text-sm text-gray-600 mb-4">관리자 페이지 접근을 위한 인증입니다.</p>

        {error ? (
          <div className="mb-4 px-3 py-2 rounded border border-red-200 bg-red-50 text-red-700 text-sm">
            아이디/비밀번호가 올바르지 않습니다.
          </div>
        ) : null}

        <form method="POST" action="/admin/login" className="space-y-3">
          <label className="block">
            <div className="text-sm font-medium text-gray-700">ID</div>
            <input
              name="id"
              defaultValue="admin"
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <div className="text-sm font-medium text-gray-700">PW</div>
            <input
              name="pw"
              type="password"
              defaultValue=""
              placeholder="0703"
              className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="w-full bg-slate-800 text-white rounded-md py-2.5 text-sm font-semibold hover:bg-slate-700"
          >
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}

