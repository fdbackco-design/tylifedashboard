import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '개인정보처리방침' };
export const dynamic = 'force-dynamic';

function SectionTitle(props: { children: React.ReactNode }) {
  return <h2 className="text-lg sm:text-xl font-bold text-gray-900 mt-10 mb-3">{props.children}</h2>;
}

function Table(props: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
      <table className="min-w-[640px] w-full text-sm">{props.children}</table>
    </div>
  );
}

function Th(props: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-700 bg-gray-50 border-b border-gray-200 whitespace-nowrap">{props.children}</th>;
}

function Td(props: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 text-sm text-gray-800 border-b border-gray-100 align-top">{props.children}</td>;
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 sm:p-8">
          <div className="flex items-center justify-end mb-3">
            <Link
              href="/login"
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              로그인 페이지로
            </Link>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">개인정보처리방침</h1>
          <p className="text-sm text-gray-700 mt-4 leading-relaxed">
            <span className="font-semibold">TY Life Dashboard</span>는 「개인정보 보호법」 등 관련 법령에 따라 이용자의 개인정보를 보호하고,
            개인정보와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 다음과 같이 개인정보처리방침을 수립·공개합니다.
          </p>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            본 개인정보처리방침은 <span className="font-semibold">TY Life Dashboard 웹사이트 및 모바일 앱 서비스</span>에 적용됩니다.
          </p>

          <SectionTitle>제1조 개인정보의 처리 목적</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 다음의 목적을 위해 개인정보를 처리합니다. 처리한 개인정보는 아래 목적 이외의 용도로는 이용하지 않으며,
            이용 목적이 변경되는 경우 관련 법령에 따라 별도의 동의를 받는 등 필요한 조치를 이행합니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>처리 목적</Th>
                <Th>내용</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>회원 및 계정 관리</Td>
                <Td>관리자, 영업자, 조직 구성원의 계정 생성, 로그인, 권한 관리, 본인 확인</Td>
              </tr>
              <tr>
                <Td>계약 관리</Td>
                <Td>고객 계약 정보 등록, 조회, 수정, 상태 관리</Td>
              </tr>
              <tr>
                <Td>조직 및 실적 관리</Td>
                <Td>영업 조직 구조 관리, 개인 실적 및 산하 실적 집계</Td>
              </tr>
              <tr>
                <Td>정산 관리</Td>
                <Td>계약 실적에 따른 수당, 오버라이드, 보너스, 정산 내역 산출</Td>
              </tr>
              <tr>
                <Td>서비스 운영</Td>
                <Td>오류 확인, 접속 기록 관리, 보안 관리, 시스템 개선</Td>
              </tr>
              <tr>
                <Td>고객지원 및 문의 대응</Td>
                <Td>서비스 이용 관련 문의, 오류 신고, 권한 요청 처리</Td>
              </tr>
            </tbody>
          </Table>

          <SectionTitle>제2조 처리하는 개인정보 항목</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 서비스 제공을 위해 필요한 범위에서 다음과 같은 개인정보를 처리할 수 있습니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>처리 항목</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>계정 정보</Td>
                <Td>이름, 이메일, 로그인 ID, 비밀번호 또는 인증 정보, 소속, 직급, 권한</Td>
              </tr>
              <tr>
                <Td>영업자/조직 정보</Td>
                <Td>이름, 연락처, 소속 조직, 상위 리더, 직급, 조직 관계, 활동 상태</Td>
              </tr>
              <tr>
                <Td>고객 계약 정보</Td>
                <Td>고객명, 연락처, 계약 상품, 계약 상태, 가입일, 계약 관련 메모</Td>
              </tr>
              <tr>
                <Td>정산 정보</Td>
                <Td>개인 실적, 산하 실적, 인정 구좌, 수당, 오버라이드, 보너스, 정산월</Td>
              </tr>
              <tr>
                <Td>서비스 이용 정보</Td>
                <Td>접속 일시, IP 주소, 브라우저 정보, 기기 정보, 서비스 이용 기록, 오류 로그</Td>
              </tr>
              <tr>
                <Td>문의 처리 정보</Td>
                <Td>문의자 이름, 연락처, 이메일, 문의 내용, 처리 결과</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            서비스 이용 과정에서 IP 주소, 쿠키, 접속 로그, 기기 정보 등 일부 정보가 자동으로 생성되어 수집될 수 있습니다.
          </p>

          <SectionTitle>제3조 개인정보의 처리 및 보유 기간</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 법령에 따른 개인정보 보유·이용 기간 또는 정보주체로부터 개인정보 수집 시 동의받은 보유·이용 기간 내에서 개인정보를 처리·보유합니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>보유 기간</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>계정 정보</Td>
                <Td>계정 삭제 또는 서비스 이용 종료 시까지</Td>
              </tr>
              <tr>
                <Td>계약 및 정산 정보</Td>
                <Td>계약 관리 및 정산 업무 목적 달성 시까지 또는 관련 법령상 보관 기간까지</Td>
              </tr>
              <tr>
                <Td>접속 기록 및 보안 로그</Td>
                <Td>서비스 안정성 및 보안 관리를 위해 일정 기간 보관</Td>
              </tr>
              <tr>
                <Td>문의 내역</Td>
                <Td>문의 처리 완료 후 분쟁 대응을 위해 일정 기간 보관</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            다만, 관계 법령에 따라 보존할 필요가 있는 경우에는 해당 법령에서 정한 기간 동안 보관할 수 있습니다.
          </p>

          <SectionTitle>제4조 개인정보의 제3자 제공</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 원칙적으로 정보주체의 개인정보를 제1조의 처리 목적 범위 내에서만 처리하며, 정보주체의 동의가 있거나 법령에 특별한 규정이 있는 경우를 제외하고 개인정보를 제3자에게 제공하지 않습니다.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            다만 다음의 경우에는 관련 법령에 따라 개인정보를 제공할 수 있습니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>제공 사유</Th>
                <Th>내용</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>정보주체의 동의</Td>
                <Td>이용자가 사전에 동의한 경우</Td>
              </tr>
              <tr>
                <Td>법령상 의무</Td>
                <Td>수사기관, 법원, 행정기관 등에서 법령에 따라 요구하는 경우</Td>
              </tr>
              <tr>
                <Td>계약 및 정산 업무 수행</Td>
                <Td>서비스 제공과 직접 관련된 범위에서 필요한 경우</Td>
              </tr>
            </tbody>
          </Table>

          <SectionTitle>제5조 개인정보 처리업무의 위탁</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 원활한 서비스 제공을 위해 일부 개인정보 처리업무를 외부 서비스에 위탁할 수 있습니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>수탁자</Th>
                <Th>위탁 업무</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Vercel Inc.</Td>
                <Td>웹서비스 호스팅 및 배포</Td>
              </tr>
              <tr>
                <Td>Supabase Inc.</Td>
                <Td>데이터베이스, 인증, 저장소 등 백엔드 인프라 제공</Td>
              </tr>
              <tr>
                <Td>Google LLC</Td>
                <Td>Google Play 앱 배포, 서비스 운영 관련 도구 제공</Td>
              </tr>
              <tr>
                <Td>기타 클라우드·알림·분석 도구 제공업체</Td>
                <Td>서비스 운영, 장애 확인, 보안 관리</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            위탁업무의 내용이나 수탁자가 변경되는 경우 본 개인정보처리방침을 통해 공개하겠습니다.
          </p>

          <SectionTitle>제6조 개인정보의 국외 이전</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 서비스 운영 과정에서 해외에 위치한 클라우드 서비스 제공업체를 이용할 수 있으며, 이 과정에서 개인정보가 국외에 저장 또는 처리될 수 있습니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>이전받는 자</Th>
                <Th>이전 국가</Th>
                <Th>이전 항목</Th>
                <Th>이전 목적</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>Vercel Inc.</Td>
                <Td>미국 등</Td>
                <Td>서비스 이용 정보, 배포 관련 데이터</Td>
                <Td>웹서비스 호스팅</Td>
              </tr>
              <tr>
                <Td>Supabase Inc.</Td>
                <Td>미국 등</Td>
                <Td>계정 정보, 계약 정보, 정산 정보 등 서비스 데이터</Td>
                <Td>데이터베이스 및 인증 서비스 제공</Td>
              </tr>
              <tr>
                <Td>Google LLC</Td>
                <Td>미국 등</Td>
                <Td>앱 등록 및 서비스 운영 관련 정보</Td>
                <Td>앱 배포 및 관리</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            국외 이전은 서비스 제공을 위해 필요한 범위에서 이루어지며, 관련 법령에 따라 안전하게 관리됩니다.
          </p>

          <SectionTitle>제7조 개인정보의 파기 절차 및 방법</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 개인정보 보유기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>파기 방법</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>전자적 파일</Td>
                <Td>복구 및 재생이 불가능한 방법으로 삭제</Td>
              </tr>
              <tr>
                <Td>출력물 등 종이 문서</Td>
                <Td>분쇄 또는 소각</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            다만, 관계 법령에 따라 보존해야 하는 정보는 별도 분리하여 보관 후 해당 기간이 종료되면 파기합니다.
          </p>

          <SectionTitle>제8조 정보주체의 권리와 행사 방법</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            정보주체는 TY Life Dashboard에 대해 언제든지 다음의 권리를 행사할 수 있습니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>권리</Th>
                <Th>내용</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>열람 요구</Td>
                <Td>본인의 개인정보 처리 내역 확인 요청</Td>
              </tr>
              <tr>
                <Td>정정 요구</Td>
                <Td>오류가 있는 개인정보의 수정 요청</Td>
              </tr>
              <tr>
                <Td>삭제 요구</Td>
                <Td>개인정보 삭제 요청</Td>
              </tr>
              <tr>
                <Td>처리정지 요구</Td>
                <Td>개인정보 처리 중단 요청</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            권리 행사는 개인정보 보호책임자 또는 담당 부서에 서면, 이메일 등으로 요청할 수 있으며, TY Life Dashboard는 관련 법령에 따라 지체 없이 조치합니다.
          </p>
          <p className="text-sm text-gray-700 mt-2 leading-relaxed">
            다만, 다른 법령에서 보존 의무를 정하고 있거나 계약·정산·분쟁 대응을 위해 필요한 경우에는 일부 권리 행사가 제한될 수 있습니다.
          </p>

          <SectionTitle>제9조 개인정보의 안전성 확보조치</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 개인정보의 안전성 확보를 위해 다음과 같은 조치를 취합니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>조치 내용</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>관리적 조치</Td>
                <Td>개인정보 접근 권한 관리, 내부 관리 기준 수립</Td>
              </tr>
              <tr>
                <Td>기술적 조치</Td>
                <Td>비밀번호 암호화, 접근 통제, 보안 로그 관리, HTTPS 적용</Td>
              </tr>
              <tr>
                <Td>물리적 조치</Td>
                <Td>개인정보 접근 가능 기기 및 계정 관리</Td>
              </tr>
            </tbody>
          </Table>

          <SectionTitle>제10조 쿠키 및 자동 수집 장치의 이용</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed">
            TY Life Dashboard는 로그인 상태 유지, 서비스 이용 편의 제공, 보안 관리 등을 위해 쿠키 또는 유사한 기술을 사용할 수 있습니다.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed mt-2">
            이용자는 브라우저 설정을 통해 쿠키 저장을 거부하거나 삭제할 수 있습니다. 다만 쿠키 저장을 거부할 경우 로그인 유지 등 일부 서비스 이용에 제한이 있을 수 있습니다.
          </p>

          <SectionTitle>제11조 14세 미만 아동의 개인정보 처리</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed">
            TY Life Dashboard는 원칙적으로 14세 미만 아동을 대상으로 서비스를 제공하지 않습니다.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed mt-2">
            만약 14세 미만 아동의 개인정보를 처리해야 하는 경우에는 법정대리인의 동의를 받는 등 관련 법령에서 정한 절차를 준수합니다.
          </p>

          <SectionTitle>제12조 개인정보 보호책임자 및 문의처</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            TY Life Dashboard는 개인정보 처리와 관련한 문의, 불만 처리, 피해 구제 등을 위해 아래와 같이 개인정보 보호책임자 및 담당 부서를 지정합니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>구분</Th>
                <Th>내용</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>개인정보 보호책임자</Td>
                <Td>안성준</Td>
              </tr>
              <tr>
                <Td>담당 부서</Td>
                <Td>영업부</Td>
              </tr>
              <tr>
                <Td>이메일</Td>
                <Td>tylifepartners@gmail.com</Td>
              </tr>
              <tr>
                <Td>연락처</Td>
                <Td>070-8648-1288</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            정보주체는 서비스 이용 과정에서 발생하는 개인정보 관련 문의, 불만, 피해 구제 요청을 위 연락처로 문의할 수 있습니다.
          </p>

          <SectionTitle>제13조 권익침해 구제 방법</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            정보주체는 개인정보 침해에 대한 상담이나 피해 구제를 위해 아래 기관에 문의할 수 있습니다.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>기관</Th>
                <Th>연락처</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td>개인정보침해 신고센터</Td>
                <Td>국번 없이 118</Td>
              </tr>
              <tr>
                <Td>개인정보 분쟁조정위원회</Td>
                <Td>1833-6972</Td>
              </tr>
              <tr>
                <Td>대검찰청 사이버수사과</Td>
                <Td>국번 없이 1301</Td>
              </tr>
              <tr>
                <Td>경찰청 사이버수사국</Td>
                <Td>국번 없이 182</Td>
              </tr>
            </tbody>
          </Table>
          <p className="text-sm text-gray-700 mt-3 leading-relaxed">
            개인정보 관련 신고와 상담은 개인정보 포털 및 개인정보침해 신고센터를 통해 진행할 수 있습니다.
          </p>

          <SectionTitle>제14조 개인정보처리방침의 변경</SectionTitle>
          <p className="text-sm text-gray-700 leading-relaxed">
            본 개인정보처리방침은 법령, 서비스 내용, 개인정보 처리 방식의 변경에 따라 수정될 수 있습니다.
          </p>
          <p className="text-sm text-gray-700 leading-relaxed mt-2">
            개인정보처리방침이 변경되는 경우 서비스 내 공지사항 또는 웹사이트를 통해 고지합니다.
          </p>

          <div className="mt-10 pt-4 border-t border-gray-200 text-sm text-gray-700">
            <div>공고일자: 2026년 5월 13일</div>
            <div>시행일자: 2026년 5월 13일</div>
          </div>

          <div className="mt-6 flex items-center justify-end">
            <Link
              href="/login"
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              로그인 페이지로
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

