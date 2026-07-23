import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// 매일 아침 10:10 에 대화형 로그인(npm run tylife:login) 을 자동 실행하는 launchd agent.
//
// tylife:login 은 헤드풀 Chrome 창을 띄운다. 세션이 만료됐으면 사람이 로그인 + Turnstile
// 인증을 완료해야 하고(그 동안 창은 열린 채 대기), 세션이 아직 살아있으면 창이 잠깐 떴다가
// 쿠키만 갱신하고 닫힌다. GUI 세션에서 실행되도록 LaunchAgent(gui/<uid>) 로 등록한다.
//
// 10분 주기 무인 동기화(co.feedback1.tylife-local-sync) 와는 별개의 agent 이다.

const LABEL = 'co.feedback1.tylife-login';
const HOUR = 10;
const MINUTE = 10;

const action = process.argv[2] ?? '';
const projectDir = process.cwd();
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
const logDir = path.join(projectDir, '.playwright');
const stdoutPath = path.join(logDir, 'tylife-login.log');
const stderrPath = path.join(logDir, 'tylife-login-error.log');
const loginScriptPath = path.join(projectDir, 'scripts', 'tylife-refresh-cookie.ts');
const domain = `gui/${process.getuid?.() ?? ''}`;
const whichNode = spawnSync('which', ['node'], { encoding: 'utf8' }).stdout.trim();
const nodePath = whichNode || process.execPath;

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
    <string>${xml(nodePath)}</string>
    <string>--conditions=react-server</string>
    <string>--import</string>
    <string>tsx</string>
    <string>${xml(loginScriptPath)}</string>
    <string>--login</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectDir)}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
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

  const hh = String(HOUR).padStart(2, '0');
  const mm = String(MINUTE).padStart(2, '0');
  console.log(`등록 완료: ${LABEL}`);
  console.log(`실행 시각: 매일 ${hh}:${mm}`);
  console.log(`설정: ${plistPath}`);
  console.log(`로그: ${stdoutPath}`);
}

async function uninstall() {
  launchctl(['bootout', domain, plistPath], { quiet: true });
  await rm(plistPath, { force: true });
  console.log(`제거 완료: ${LABEL}`);
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
  console.error('사용법: node scripts/tylife-login-launchd.mjs <install|uninstall>');
  process.exitCode = 1;
}
