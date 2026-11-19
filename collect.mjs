// 모든 수집기를 차례로 실행하고, 결과를 분류별 폴더에 저장한 뒤 manifest.json(목록)을 만들어요.
// 한 수집기가 실패해도 이전 파일은 그대로 두고 다음 수집기를 계속 실행해요.
//   node collect.mjs            → 전부
//   node collect.mjs naver_shop → 하나만
import { readJSON, writeJSON, exists, products, mapping } from './collectors/lib.mjs';
import * as naver from './collectors/naver-shop.mjs';
import * as kamis from './collectors/kamis.mjs';
import * as customs from './collectors/customs.mjs';
import * as ecos from './collectors/ecos.mjs';
import * as kosis from './collectors/kosis.mjs';
import * as foodsafety from './collectors/foodsafety.mjs';

const COLLECTORS = [naver, kamis, customs, ecos, kosis, foodsafety];
// 저장소에 파일로 들어 있는 DB (수집기 없이 고정)
const STATIC_DB = [
    { id: 'chamgagyeok_csv', name: '한국소비자원 참가격 CSV (2026-10-23)', kind: 'commerce', type: 'db', provider: '한국소비자원 · data.go.kr 15083256', file: 'data/commerce/db/chamgagyeok-csv.json', note: '오프라인 체인 10곳 실제 가격 · 상품 60개' },
    { id: 'chamgagyeok_cost', name: '참가격 역산 추정 원가', kind: 'distribution', type: 'db', provider: 'ValueLens 계산', file: 'data/distribution/db/chamgagyeok-cost.json', note: '실제 가격 하위 25% ÷ 적정 배수 상한' }
];

// 유통 · DB: 참가격 역산 추정 원가 — 참가격 CSV 요약에서 ValueLens와 같은 규칙으로 계산
// (실제 가격 하위 25% ÷ 카테고리 적정 배수 상한, 원재료비·공임·물류비는 카테고리 평균 비중)
if (exists('data/commerce/db/chamgagyeok-csv.json')) {
    const R = x => { const f = Math.floor(x), d = x - f; return Math.abs(d - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(x); };   // 사이트(파이썬 round)와 같은 반올림
    const HI = { food: 2.0, life: 2.4, beauty: 4.0 }, SPLIT = { food: [0.629, 0.203], life: [0.524, 0.257], beauty: [0.325, 0.434] };
    const rows = readJSON('data/commerce/db/chamgagyeok-csv.json').products.map(p => {
        const cost = p.p25_20261023 / HI[p.category], m = R(cost * SPLIT[p.category][0]), l = R(cost * SPLIT[p.category][1]), g = R(cost) - m - l;
        return { code: p.code, name: p.name, category: p.category, material: m, labor: l, logistics: g, total: m + l + g };
    });
    writeJSON('data/distribution/db/chamgagyeok-cost.json', { source: { id: 'chamgagyeok_cost', name: '참가격 역산 추정 원가', kind: 'distribution', type: 'db', provider: 'ValueLens 계산 (참가격 하위 25% 가격 ÷ 카테고리 적정 배수 상한)' }, products: rows });
}

const only = process.argv[2];
const prev = exists('data/manifest.json') ? readJSON('data/manifest.json') : { sources: [] };
const prevById = Object.fromEntries((prev.sources || []).map(s => [s.id, s]));
const now = new Date().toISOString();
const results = [];

for (const c of COLLECTORS) {
    const m = c.meta, old = prevById[m.id];
    if (only && only !== m.id) { if (old) results.push(old); continue; }
    process.stdout.write(`▶ ${m.name} … `);
    let r;
    try { r = await c.run(); }
    catch (e) { r = { status: 'error', message: String(e.message || e).replace(/(serviceKey|apiKey|p_cert_key)=[^&\s]+/gi, '$1=***') }; }
    console.log(`${r.status} · ${r.message}`);
    if (r.status === 'ok') {
        writeJSON(m.file, { source: { id: m.id, name: m.name, kind: m.kind, type: m.type, provider: m.provider }, collectedAt: now, ...r.data });
        results.push({ ...m, status: 'ok', message: r.message, count: r.count, updatedAt: now, checkedAt: now });
    } else {
        // 실패·건너뜀: 이전에 모은 파일이 있으면 계속 씀
        const kept = old && old.updatedAt && exists(m.file);
        results.push({ ...m, status: kept && r.status === 'error' ? 'stale' : r.status, message: r.message + (kept ? ` (이전 수집분 ${old.updatedAt.slice(0, 10)} 유지)` : ''),
            count: kept ? old.count : 0, updatedAt: kept ? old.updatedAt : null, checkedAt: now, file: kept || r.status === 'ok' ? m.file : null });
    }
}

// 상품별 원가 변동 지표 후보 (유통 API 연결 규칙)
const map = mapping(), drivers = {};
for (const p of products()) {
    const rule = map.rules.find(r => r.category === p.category && r.keywords.some(k => p.name.includes(k)));
    drivers[p.code] = { material: [...(rule ? rule.material : []), ...(map.defaults.material[p.category] || [])], labor: map.defaults.labor, logistics: map.defaults.logistics };
}
writeJSON('data/distribution/cost-drivers.json', { note: '상품별 원가 변동 지표 후보. 앞에서부터 켜져 있고 값이 있는 소스를 써요.', products: drivers });

const sources = [...STATIC_DB.map(s => ({ ...s, status: exists(s.file) ? 'ok' : 'missing', updatedAt: s.id === 'chamgagyeok_csv' ? '2026-11-03T00:00:00Z' : now, count: exists(s.file) ? readJSON(s.file).products.length : 0 })), ...results];
writeJSON('data/manifest.json', {
    app: 'ValueLens', kind: 'data-manifest', version: 1, generatedAt: now,
    folders: { 'distribution/db': '유통 · DB', 'distribution/api': '유통 · API', 'commerce/db': '커머스 · DB', 'commerce/api': '커머스 · API' },
    costDrivers: 'data/distribution/cost-drivers.json',
    sources
});
console.log(`manifest: 소스 ${sources.length}개 (ok ${sources.filter(s => s.status === 'ok').length})`);
