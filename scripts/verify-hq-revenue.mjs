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

function unitPrice(productType, happyCallAt) {
  const text = (productType ?? '').trim();
  const ymd = happyCallAt ? String(happyCallAt).slice(0, 10) : null;

  if (text.includes('갤럭시케어 라이트')) return PRICES.lite;
  if (text.includes('TY갤럭시케어')) {
    return ymd && ymd >= TY_INCREASE ? PRICES.tyFrom : PRICES.tyBefore;
  }
  if (text.includes('올라이프케어')) return PRICES.olife;
  if (text.includes('일반가전')) return PRICES.appliance;
  return ymd && ymd >= TY_INCREASE ? PRICES.tyFrom : PRICES.tyBefore;
}

function revenue(productType, happyCallAt, units) {
  return Math.max(0, Number(units ?? 0)) * unitPrice(productType, happyCallAt);
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
