import type { Metadata } from 'next';
import AccountIssueClient from './AccountIssueClient';

export const metadata: Metadata = { title: '계정 발급' };
export const dynamic = 'force-dynamic';

export default function AccountIssuePage() {
  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">계정 발급</h2>
        <p className="text-sm text-gray-500 mt-1">
          고객을 검색/선택한 뒤, 해당 고객과 연결된 조직원(회원)에게 로그인 계정을 발급합니다.
        </p>
      </div>
      <AccountIssueClient />
    </div>
  );
}

