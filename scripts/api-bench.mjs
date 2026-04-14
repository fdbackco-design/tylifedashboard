function nowMs() {
  const [s, ns] = process.hrtime();
  return s * 1000 + ns / 1e6;
}

function joinUrl(base, path) {
  if (!base) return path;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

async function fetchAndMeasure(name, url, init) {
  const start = nowMs();
  try {
    const res = await fetch(url, init);
    const buf = await res.arrayBuffer();
    const ms = nowMs() - start;

    const header = (k) => res.headers.get(k) ?? '';
    const cache = header('x-vercel-cache') || header('x-cache') || '';
    const age = header('age');
    const server = header('server');
    const cacheControl = header('cache-control');
    const region = header('x-vercel-id'); // includes region suffix sometimes

    return {
      name,
      url,
      ok: res.ok,
      status: res.status,
      ms,
      bytes: buf.byteLength,
      cache,
      age,
      server,
      cacheControl,
      region,
    };
  } catch (e) {
    const ms = nowMs() - start;
    return {
      name,
      url,
      ok: false,
      status: 0,
      ms,
      bytes: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function printTable(results) {
  const sorted = [...results].sort((a, b) => b.ms - a.ms);
  const rows = sorted.map((r) => ({
    name: r.name,
    status: r.status,
    ok: r.ok,
    ms: Math.round(r.ms),
    kb: r.bytes == null ? '' : (r.bytes / 1024).toFixed(1),
    cache: r.cache ?? '',
    age: r.age ?? '',
    url: r.url,
    error: r.error ?? '',
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
}

function quantile(sortedNums, q) {
  if (sortedNums.length === 0) return null;
  const pos = (sortedNums.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedNums[base + 1] === undefined) return sortedNums[base];
  return sortedNums[base] + rest * (sortedNums[base + 1] - sortedNums[base]);
}

function summarize(allResults) {
  const byName = new Map();
  for (const r of allResults) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }

  const rows = [];
  for (const [name, rs] of byName.entries()) {
    const okCount = rs.filter((x) => x.ok).length;
    const msSorted = rs.map((x) => x.ms).sort((a, b) => a - b);
    const cacheCounts = rs.reduce(
      (acc, r) => {
        const key = (r.cache ?? '').trim() || 'none';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );
    rows.push({
      name,
      n: rs.length,
      ok: `${okCount}/${rs.length}`,
      p50_ms: Math.round(quantile(msSorted, 0.5)),
      p95_ms: Math.round(quantile(msSorted, 0.95)),
      min_ms: Math.round(msSorted[0]),
      max_ms: Math.round(msSorted[msSorted.length - 1]),
      cache: Object.entries(cacheCounts)
        .map(([k, v]) => `${k}:${v}`)
        .join(', '),
    });
  }

  rows.sort((a, b) => b.p95_ms - a.p95_ms);
  // eslint-disable-next-line no-console
  console.table(rows);
}

async function main() {
  const baseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const syncSecret = process.env.SYNC_API_SECRET ?? '';
  const iterations = Math.max(1, parseInt(process.env.ITERATIONS ?? '5', 10));

  if (!baseUrl) {
    throw new Error('API_BASE_URL 환경변수가 필요합니다. 예: https://your-app.vercel.app');
  }

  const authHeaders = syncSecret.length > 0 ? { Authorization: `Bearer ${syncSecret}` } : undefined;

  const d = new Date();
  const defaultYearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const yearMonth = process.env.BENCH_YEAR_MONTH ?? defaultYearMonth;

  const all = [];
  for (let i = 1; i <= iterations; i++) {
    // eslint-disable-next-line no-console
    console.log(`\n[iteration ${i}/${iterations}]`);
    const targets = [
      fetchAndMeasure('GET /api/contracts (no count)', joinUrl(baseUrl, `/api/contracts?page=1`)),
      fetchAndMeasure(
        'GET /api/contracts (include_count=true)',
        joinUrl(baseUrl, `/api/contracts?page=1&include_count=true`),
      ),
      fetchAndMeasure('GET /api/organization', joinUrl(baseUrl, `/api/organization`)),
      fetchAndMeasure(
        `GET /api/settlement?year_month=${yearMonth}`,
        joinUrl(baseUrl, `/api/settlement?year_month=${encodeURIComponent(yearMonth)}`),
      ),
      fetchAndMeasure(
        `GET /api/settlement?year_month=${yearMonth}&include_detail=true`,
        joinUrl(
          baseUrl,
          `/api/settlement?year_month=${encodeURIComponent(yearMonth)}&include_detail=true`,
        ),
      ),
      fetchAndMeasure(
        'GET /api/sync (auth)',
        joinUrl(baseUrl, `/api/sync`),
        authHeaders ? { headers: authHeaders } : undefined,
      ),
    ];
    const results = await Promise.all(targets);
    printTable(results);
    all.push(...results);
  }

  // eslint-disable-next-line no-console
  console.log('\n[summary]');
  summarize(all);

  const failures = all.filter((r) => !r.ok);
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error('실패한 요청이 있습니다. 위 테이블의 ok/status/error를 확인하세요.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

