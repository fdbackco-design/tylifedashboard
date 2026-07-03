/**
 * 본사 매출 단가 정책 자가 검증 (npm run verify:hq-revenue)
 * hq-revenue.ts 예시·경계일과 동일한 케이스를 검증한다.
 * TY갤럭시케어 6/26 분기는 해피콜 완료일(happy_call_at) 기준.
 */

const TY_INCREASE = '2026-06-26';
const PRICES = {
  tyBefore: 715_000,
  tyFrom: 770_000,
  olife: 605_000,
  appliance: 550_000,
  lite: 500_000,
};

function collectProductTexts(productType, itemName, snapshotProduct) {
  return [productType, itemName, snapshotProduct].map((t) => String(t ?? '').trim()).filter(Boolean);
}

function isTyGalaxyCareProductText(text) {
  const t = text.trim();
  if (!t) return false;
  if (t === '무') return true;
  if (t.includes('TY갤럭시케어_ALL')) return true;
  if (t.includes('TY갤럭시케어_무')) return true;
  if (t.includes('TY갤럭시케어')) return true;
  return false;
}

function unitPrice(productType, happyCallAt, itemName, snapshotProduct) {
  const texts = collectProductTexts(productType, itemName, snapshotProduct);
  const ymd = happyCallAt ? String(happyCallAt).slice(0, 10) : null;

  if (texts.some((t) => t.includes('갤럭시케어 라이트'))) return PRICES.lite;
  if (texts.some(isTyGalaxyCareProductText)) {
    return ymd && ymd >= TY_INCREASE ? PRICES.tyFrom : PRICES.tyBefore;
  }
  for (const text of texts) {
    if (text.includes('올라이프케어')) return PRICES.olife;
    if (text.includes('일반가전')) return PRICES.appliance;
  }
  return ymd && ymd >= TY_INCREASE ? PRICES.tyFrom : PRICES.tyBefore;
}

function revenue(productType, happyCallAt, units, itemName, snapshotProduct) {
  return Math.max(0, Number(units ?? 0)) * unitPrice(productType, happyCallAt, itemName, snapshotProduct);
}

const failures = [];
function assertEq(label, actual, expected) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

assertEq('TY 2026-06-25', revenue('TY갤럭시케어', '2026-06-25', 2), 1_430_000);
assertEq('TY 2026-06-26', revenue('TY갤럭시케어', '2026-06-26', 1), 770_000);
assertEq('올라이프케어', revenue('올라이프케어', '2026-06-26', 3), 1_815_000);
assertEq('일반가전', unitPrice('일반가전', '2026-01-01'), 550_000);
assertEq('갤럭시케어 라이트', unitPrice('갤럭시케어 라이트', '2026-01-01'), 500_000);
assertEq('TY갤럭시케어_무', revenue('무', '2026-06-26', 1, null, 'TY갤럭시케어_무'), 770_000);
assertEq('TY갤럭시케어_ALL', revenue('TY갤럭시케어', '2026-06-26', 1, null, 'TY갤럭시케어_ALL'), 770_000);
assertEq(
  '기간 합계',
  revenue('TY갤럭시케어', '2026-06-25', 2) +
    revenue('TY갤럭시케어', '2026-06-26', 1) +
    revenue('올라이프케어', '2026-06-26', 3),
  4_015_000,
);

if (failures.length === 0) {
  console.log('hq-revenue self-check: OK');
  process.exit(0);
}

console.error('hq-revenue self-check: FAILED');
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
