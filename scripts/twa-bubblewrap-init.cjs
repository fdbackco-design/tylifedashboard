#!/usr/bin/env node
/**
 * Bubblewrap TWA 프로젝트를 비대화형으로 생성합니다.
 * 배포 URL에 manifest.json이 아직 없을 때는 public/을 로컬 HTTP로 제공해 아이콘·매니페스트를 가져옵니다.
 *
 * 환경변수: TWA_KEYSTORE_PASSWORD (기본값: 스크립트 내 DEV 기본 비밀번호 — 운영 전 반드시 변경)
 *
 * 이후 빌드(시스템에 ANDROID_SDK_ROOT가 있으면 Gradle이 충돌함 — 제거 후 실행):
 *   cd twa-android && env -u ANDROID_SDK_ROOT BUBBLEWRAP_KEYSTORE_PASSWORD='...' BUBBLEWRAP_KEY_PASSWORD='...' bubblewrap build
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(REPO_ROOT, 'public');
const TWA_DIR = path.join(REPO_ROOT, 'twa-android');
const WELL_KNOWN = path.join(PUBLIC, '.well-known');

const PORT = Number(process.env.TWA_INIT_HTTP_PORT || 18765);
const HOST_DOMAIN = 'tylifedashboard.vercel.app';
const PACKAGE_ID = 'com.tylife.dashboard';
const KEY_ALIAS = 'android';
const KEYSTORE_PASS =
  process.env.TWA_KEYSTORE_PASSWORD || 'TylifeDash2026!ChangeMe';

function npmGlobalRoot() {
  return execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
}

function loadBubblewrapModules() {
  const root = npmGlobalRoot();
  const cliRoot = path.dirname(
    require.resolve('@bubblewrap/cli/package.json', {
      paths: [path.join(root, '@bubblewrap/cli')],
    }),
  );
  const coreRoot = path.dirname(
    require.resolve('@bubblewrap/core/package.json', {
      paths: [path.join(root, '@bubblewrap/cli')],
    }),
  );
  const shared = require(path.join(cliRoot, 'dist/lib/cmds/shared.js'));
  const {
    TwaManifest,
    TwaGenerator,
    ConsoleLog,
    BufferedLog,
    DigitalAssetLinks,
  } = require(coreRoot);
  return { shared, TwaManifest, TwaGenerator, ConsoleLog, BufferedLog, DigitalAssetLinks };
}

function startPublicServer(port) {
  return new Promise((resolve, reject) => {
    const rootResolved = path.resolve(PUBLIC);
    const server = http.createServer((req, res) => {
      try {
        const raw = req.url.split('?')[0];
        let rel = decodeURIComponent(raw);
        if (rel.startsWith('/')) rel = rel.slice(1);
        if (!rel || rel === '') rel = 'index.html';
        const filePath = path.resolve(rootResolved, rel);
        if (!filePath.startsWith(rootResolved + path.sep) && filePath !== rootResolved) {
          res.writeHead(403);
          res.end();
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const ext = path.extname(filePath);
          const ct =
            ext === '.json'
              ? 'application/json; charset=utf-8'
              : ext === '.png'
                ? 'image/png'
                : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': ct });
          res.end(data);
        });
      } catch {
        res.writeHead(500);
        res.end();
      }
    });
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function ensureKeystore(keystorePath) {
  if (fs.existsSync(keystorePath)) return;
  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-v',
      '-keystore',
      keystorePath,
      '-alias',
      KEY_ALIAS,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass',
      KEYSTORE_PASS,
      '-keypass',
      KEYSTORE_PASS,
      '-dname',
      'CN=TY Life Dashboard, OU=Mobile, O=TY Life, L=Seoul, ST=Seoul, C=KR',
    ],
    { stdio: 'inherit' },
  );
}

function sha256FingerprintColonUpper(keystorePath) {
  const out = execFileSync(
    'keytool',
    [
      '-list',
      '-v',
      '-keystore',
      keystorePath,
      '-alias',
      KEY_ALIAS,
      '-storepass',
      KEYSTORE_PASS,
    ],
    { encoding: 'utf8' },
  );
  const m = out.match(/SHA256:\s*([0-9A-Fa-f:]+)/);
  if (!m) throw new Error('keytool 출력에서 SHA256 지문을 찾지 못했습니다.');
  return m[1].toUpperCase();
}

async function main() {
  const { shared, TwaManifest, TwaGenerator, ConsoleLog, BufferedLog, DigitalAssetLinks } =
    loadBubblewrapModules();

  fs.mkdirSync(TWA_DIR, { recursive: true });
  const keystorePath = path.join(TWA_DIR, 'android.keystore');
  ensureKeystore(keystorePath);
  const fingerprint = sha256FingerprintColonUpper(keystorePath);

  const server = await startPublicServer(PORT);
  const base = `http://127.0.0.1:${PORT}`;
  const localManifestUrl = `${base}/manifest.json`;
  const manifestUrlObj = new URL(localManifestUrl);
  const webManifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'),
  );

  const twa = TwaManifest.fromWebManifestJson(manifestUrlObj, webManifest);
  twa.packageId = PACKAGE_ID;
  twa.host = HOST_DOMAIN;
  twa.webManifestUrl = manifestUrlObj;
  twa.signingKey = { path: './android.keystore', alias: KEY_ALIAS };
  twa.generatorApp = 'bubblewrap-cli';
  twa.fingerprints = [{ name: `${KEY_ALIAS} release`, value: fingerprint }];

  const prompt = { printMessage: (m) => console.log(m) };
  const log = new BufferedLog(new ConsoleLog('twa-init'));
  const gen = new TwaGenerator();
  try {
    await shared.generateTwaProject(prompt, gen, TWA_DIR, twa);
  } finally {
    server.close();
  }
  log.flush();

  twa.webManifestUrl = new URL(`https://${HOST_DOMAIN}/manifest.json`);
  twa.iconUrl = `https://${HOST_DOMAIN}/icons/icon-512.png`;
  if (twa.maskableIconUrl) {
    try {
      const u = new URL(twa.maskableIconUrl);
      if (u.hostname === '127.0.0.1') twa.maskableIconUrl = undefined;
    } catch {
      /* ignore */
    }
  }

  const manifestFile = path.join(TWA_DIR, 'twa-manifest.json');
  await twa.saveToFile(manifestFile);
  await shared.generateManifestChecksumFile(manifestFile, TWA_DIR);

  fs.mkdirSync(WELL_KNOWN, { recursive: true });
  const assetLinksBody = DigitalAssetLinks.generateAssetLinks(PACKAGE_ID, fingerprint);
  fs.writeFileSync(path.join(WELL_KNOWN, 'assetlinks.json'), assetLinksBody, 'utf8');

  console.log('\n--- TWA 초기화 완료 ---');
  console.log('패키지:', PACKAGE_ID);
  console.log('도메인:', HOST_DOMAIN);
  console.log('SHA-256 인증서 지문 (assetlinks / Play Console용):', fingerprint);
  console.log('키스토어:', keystorePath);
  console.log('비밀번호: 환경변수 TWA_KEYSTORE_PASSWORD 또는 스크립트 기본값(변경 권장)');
  console.log('assetlinks.json:', path.join(WELL_KNOWN, 'assetlinks.json'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
