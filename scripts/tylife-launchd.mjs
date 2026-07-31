import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const LABEL = 'co.feedback1.tylife-local-sync';
const action = process.argv[2] ?? '';
const projectDir = process.cwd();
const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
const plistPath = path.join(launchAgentsDir, `${LABEL}.plist`);
const logDir = path.join(os.homedir(), 'Library', 'Logs', 'tylifedashboard');
const stdoutPath = path.join(logDir, 'tylife-launchd.log');
const stderrPath = path.join(logDir, 'tylife-launchd-error.log');
const syncScriptPath = path.join(projectDir, 'scripts', 'tylife-local-cookie-sync.ts');
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
    <string>${xml(syncScriptPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(projectDir)}</string>
  <key>StartInterval</key>
  <integer>600</integer>
  <key>RunAtLoad</key>
  <false/>
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
  console.log(`주기: 10분`);
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
  console.error('사용법: node scripts/tylife-launchd.mjs <install|uninstall>');
  process.exitCode = 1;
}
