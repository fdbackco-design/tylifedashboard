import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// iMac이 잠들지 않게 유지하는 launchd agent (sudo 불필요).
//
// TY Life 세션이 유휴 타임아웃 방식이면, 10분 주기 무인 동기화
// (co.feedback1.tylife-local-sync)가 매번 인증 요청을 보내 세션을 계속 살린다.
// 하지만 맥이 잠들면 그 동기화가 멈춰 세션이 만료된다.
//
// 이 agent는 `caffeinate`를 계속 실행해 시스템 잠자기(idle/system/disk)를 막는다.
//   -i : 유휴(idle) 시스템 잠자기 방지
//   -s : 시스템 잠자기 방지 (AC 전원일 때) — 데스크톱 iMac은 상시 AC
//   -m : 디스크 유휴 잠자기 방지
// 디스플레이는 끄도 무방하므로 -d(디스플레이 켜짐 유지)는 넣지 않는다.
//
// KeepAlive=true 로 caffeinate가 죽으면 자동 재시작한다.
// 해제하려면 uninstall — 그러면 원래 잠자기 설정으로 돌아간다(pmset 변경 없음).

const LABEL = 'co.feedback1.tylife-keep-awake';
const CAFFEINATE = '/usr/bin/caffeinate';

const action = process.argv[2] ?? '';
const projectDir = process.cwd();
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
const logDir = path.join(os.homedir(), 'Library', 'Logs', 'tylifedashboard');
const stdoutPath = path.join(logDir, 'tylife-keep-awake.log');
const stderrPath = path.join(logDir, 'tylife-keep-awake-error.log');
const domain = `gui/${process.getuid?.() ?? ''}`;

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function launchctl(args, options = {}) {
  return spawnSync('launchctl', args, {
    encoding: 'utf8',
    stdio: options.quiet ? 'ignore' : 'inherit',
  });
}

async function install() {
  await mkdir(launchAgentsDir, { recursive: true });
  await mkdir(logDir, { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(CAFFEINATE)}</string>
    <string>-i</string>
    <string>-s</string>
    <string>-m</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;

  await writeFile(plistPath, plist, { encoding: 'utf8', mode: 0o600 });
  launchctl(['bootout', domain, plistPath], { quiet: true });
  const result = launchctl(['bootstrap', domain, plistPath]);
  if (result.status !== 0) {
    throw new Error(`launchd 등록 실패(exit=${result.status ?? 'unknown'})`);
  }

  console.log(`등록 완료: ${LABEL}`);
  console.log('동작: caffeinate로 시스템 잠자기를 상시 방지 (sudo 불필요, pmset 변경 없음)');
  console.log(`설정: ${plistPath}`);
  console.log(`로그: ${stdoutPath}`);
}

async function uninstall() {
  launchctl(['bootout', domain, plistPath], { quiet: true });
  await rm(plistPath, { force: true });
  console.log(`제거 완료: ${LABEL} (원래 잠자기 설정으로 복귀)`);
}

if (process.platform !== 'darwin') {
  throw new Error('이 설정은 macOS launchd 전용입니다.');
}
if (!domain.match(/^gui\/\d+$/)) {
  throw new Error('현재 macOS 사용자 UID를 확인할 수 없습니다.');
}

if (action === 'install') await install();
else if (action === 'uninstall') await uninstall();
else {
  console.error('사용법: node scripts/tylife-keepawake-launchd.mjs <install|uninstall>');
  process.exitCode = 1;
}
