# TY Life 세션 & 주말 로그인 운영 가이드

## 배경: 왜 로그인이 반복 필요한가

TY Life 로그인 세션은 **절대 만료(absolute lifetime)** 방식이다. 발급 후 일정 시간이 지나면
**활동 여부와 무관하게** 서버가 세션을 무효화한다.

- 2026-07-23 실측: iMac 잠자기를 `caffeinate`로 완전히 막고 10분 주기 동기화가 매번 인증
  요청을 보냈는데도 세션이 특정 시점에 죽었다. → **유휴 타임아웃이 아니라 절대 만료.**
- refresh token / 세션 갱신 API 없음(레거시 세션 쿠키 1개뿐). 새 세션은 오직 `/auth`
  폼 로그인으로만 발급되고, 그 로그인은 Cloudflare Turnstile("사람입니다")로 막혀 있다.
- 결론: **주기적으로 사람이 Turnstile 로그인을 해줘야 한다.** 완전 무인화는 Turnstile을
  우회하지 않는 한 불가능.

## 현재 구성된 launchd agent 3개

| Label | 스크립트 | 주기 | 역할 |
|---|---|---|---|
| `co.feedback1.tylife-local-sync` | `tylife-local-cookie-sync.ts` | 10분 | 무인 동기화 + 세션 상태 기록 + 만료 시 푸시 |
| `co.feedback1.tylife-login` | `tylife-refresh-cookie.ts --login` | 매일 10:10 | 로그인 창 자동 오픈(사람이 Turnstile 완료) |
| `co.feedback1.tylife-keep-awake` | `caffeinate -i -s -m` | 상시 | iMac 잠자기 방지(예약·동기화가 제때 실행되게) |

설치/제거:
```bash
npm run sync:tylife-launchd:install      # / :uninstall   (10분 동기화)
npm run tylife:login-launchd:install     # / :uninstall   (매일 10:10 로그인 창)
npm run tylife:keepawake-launchd:install # / :uninstall   (잠자기 방지)
```

로그인 시각(10:10)을 바꾸려면 `scripts/tylife-login-launchd.mjs` 상단 `HOUR`/`MINUTE` 수정 후
`tylife:login-launchd:install` 재실행.

---

## (3) 세션 수명 정밀 측정

10분 동기화가 매 실행마다 세션 상태를 타임스탬프와 함께
`.playwright/tylife-session-probe.log`에 남긴다. 대화형 로그인(`npm run tylife:login`) 성공 시
`LOGIN` 이벤트도 기록된다.

형식(탭 구분): `2026-07-23 10:04:41 KST\t<STATUS>` — STATUS = `LOGIN` | `VALID` | `EXPIRED` | `ERROR`

**로그인 → 첫 만료까지의 수명 확인:**
```bash
cd ~/Documents/tylifedashboard
awk -F'\t' '
  $2=="LOGIN"   { L=$1; e="" }
  $2=="EXPIRED" && L && e=="" { e=$1; print "세션 발급:", L, " → 첫 만료:", e }
' .playwright/tylife-session-probe.log
```
출력된 두 시각의 차이가 세션 절대 수명이다. 이 값을 보고 `tylife-login` 예약 시각을
"만료 직전"으로 맞추면 하루 로그인 1회로 커버할 수 있는지 판단할 수 있다.

전체 흐름을 그냥 눈으로 보려면:
```bash
tail -50 .playwright/tylife-session-probe.log
```

---

## (2) 주말 원격 1-탭 로그인 (iPhone → iMac)

주말에도 iMac은 켜둔 채(잠자기 방지 agent가 살아있음), 매일 10:10에 로그인 창이 자동으로
뜬다. 폰에서 iMac 화면에 원격 접속해 **Turnstile 체크 한 번 + 로그인 버튼**만 누르면 끝.

### 방법 A. Chrome Remote Desktop (권장 — 무료, 외부망에서도 됨)

1. **iMac(호스트) 설정**
   - Chrome에서 <https://remotedesktop.google.com/access> 접속 → "원격 액세스 설정"
   - 안내대로 확장/도우미 설치 → 컴퓨터 이름 지정 → **PIN(6자리 이상)** 설정
   - macOS 권한 요청 시 **손쉬운 사용/화면 기록** 권한 허용(입력 제어에 필요)
2. **iPhone(클라이언트)**
   - App Store에서 **"Chrome Remote Desktop"** 설치 → iMac과 **같은 Google 계정** 로그인
   - 목록에서 iMac 선택 → PIN 입력 → 화면이 뜨면 Turnstile 체크·로그인 완료
   - 장점: 집 밖에서도 됨(NAT/방화벽 자동 처리), 무료

### 방법 B. macOS 화면 공유(VNC) + iOS VNC 앱 (같은 네트워크)

1. **iMac**: 시스템 설정 → 일반 → 공유 → **화면 공유** 켜기
   - 접근 계정 지정, 표시되는 주소(예: `vnc://192.168.0.x`) 확인
2. **iPhone**: VNC 클라이언트 앱(RealVNC Viewer / Jump Desktop / Screens 등) 설치 →
   iMac 로컬 IP로 접속 → 로그인
   - 주의: 기본적으로 **같은 Wi-Fi(로컬망)** 에서만 됨. 외부에서 쓰려면 VPN 또는 포트포워딩 필요.
   - 외부 접속이 필요하면 방법 A를 권장.

> 어느 방법이든, 원격에서 **입력(클릭) 제어**가 되어야 Turnstile을 누를 수 있다. 두 방법 모두 지원.

---

## (1) 만료 시 푸시 알림 ("지금 로그인 필요")

10분 동기화가 세션 만료(`EXPIRED`)를 감지하면 **관리자에게 웹푸시 1회**를 보낸다.
(만료 구간당 1회만 — 세션이 다시 살아나면 자동 리셋되어 다음 만료 때 재알림.)

- 제목: **TY Life 로그인 필요**
- 내용: TY 세션이 만료되었습니다. iMac에서 로그인 창을 열어 인증을 완료해 주세요.

### 푸시가 실제로 도착하려면 (사전 준비)

1. **웹푸시(VAPID) 환경변수**가 설정되어 있어야 한다(앱 푸시와 동일 키). 미설정이면 발송이
   `sent=0`으로 로그만 남는다.
2. **폰에서 이 앱의 푸시 구독이 되어 있어야 한다** — 관리자 계정(`role='admin'`)으로 앱에
   로그인 후, 브라우저/PWA에서 알림 권한을 허용해 구독을 만들어 둔다.
3. 발송 결과는 동기화 로그에서 확인:
   ```bash
   grep "만료 푸시" .playwright/tylife-launchd.log | tail
   # 예: [tylife-local-cookie] 만료 푸시: sent=1, subs=1, admins=1
   ```
   `subs=0`이면 폰 구독이 없는 것, `sent=0 & subs>0`이면 VAPID/발송 설정 문제다.

### 동작 원리(중복 방지)

- 만료 감지 → `.playwright/tylife-expiry-notified.flag` 없으면 푸시 발송 후 플래그 생성.
- 이미 플래그가 있으면(같은 만료 구간) 재발송 안 함.
- 세션이 다시 `VALID`가 되면 플래그 삭제 → 다음 만료 때 다시 1회 알림.

---

## 권장 운영 흐름 (요약)

1. 평일: 매일 10:10 로그인 창이 iMac에 자동으로 뜸 → 자리에서 Turnstile 완료.
2. 만료가 감지되면 폰으로 **푸시** 도착 → 언제든 원격 1-탭 로그인.
3. 주말: 폰 → iMac 원격 접속(Chrome Remote Desktop)으로 로그인만 완료.
4. `tylife-session-probe.log`로 실제 세션 수명을 측정해, 필요하면 10:10을 만료 직전으로 조정.
