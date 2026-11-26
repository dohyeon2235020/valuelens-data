// 커머스 · API — 한국소비자원 참가격 (생필품 가격 정보, 공공데이터포털 15083256)
// 매달 올라오는 조사 자료(전국 마트·슈퍼·백화점·편의점 판매가격)를 API로 받아 상품 × 판매처(체인) 가격으로 묶어요.
//   · 가장 최근 자료: 체인별 점포 수·중간값·최저·최고·세일 점포 수
//   · 최근 7개 자료: 상품별 월 중간값 (실제 판매가 추이)
// 필요한 Secret: DATA_GO_KR_KEY (공공데이터포털에서 '한국소비자원_생필품 가격 정보' 오픈API 활용신청)
// 지난 달 자료는 바뀌지 않으므로, 이전에 모은 월 중간값은 다시 받지 않아요.
import { readJSON, exists, fetchJSON, median, sleep, env } from './lib.mjs';

export const meta = { id: 'chamgagyeok_api', name: '한국소비자원 참가격 (API)', kind: 'commerce', type: 'api', provider: '한국소비자원 · data.go.kr 15083256', file: 'data/commerce/api/chamgagyeok.json',
    note: '전국 마트·슈퍼·백화점·편의점 생필품 실제 판매가격' };

const NS = '15083256/v1';
const DOCS = `https://infuser.odcloud.kr/oas/docs?namespace=${NS}`;
const API = 'https://api.odcloud.kr/api';
const KEEP = 7;            // 추이로 쓸 최근 자료 수
const PER_PAGE = 10000;

// 판매업소 이름 → 체인 (앞에서부터 처음 맞는 것)
const CHAINS = [
    ['이마트24', /^이마트\s*24/], ['이마트 에브리데이', /^이마트\s*에브리데이/], ['노브랜드', /^노브랜드/], ['이마트', /^이마트|^E-?MART/i],
    ['롯데마트', /^롯데마트|^롯데\s*마트|^빅마켓/], ['롯데슈퍼', /^롯데슈퍼|^롯데\s*프레시/], ['롯데백화점', /^롯데백화점/],
    ['홈플러스 익스프레스', /^홈플러스\s*익스프레스/], ['홈플러스', /^홈플러스/],
    ['GS더프레시', /^GS\s*더\s*프레시|^GS\s*수퍼|^GS\s*슈퍼|^GS\s*THE\s*FRESH/i], ['GS25', /^GS\s*25/i],
    ['농협하나로마트', /하나로|^농협/], ['현대백화점', /^현대백화점/], ['신세계백화점', /^신세계/], ['갤러리아', /^갤러리아/],
    ['CU', /^CU\b|^씨유/i], ['세븐일레븐', /^세븐일레븐|^7-?ELEVEN/i], ['미니스톱', /^미니스톱/], ['킴스클럽', /^킴스클럽/], ['코스트코', /^코스트코/],
    ['메가마트', /^메가마트/], ['탑마트', /^탑마트/], ['하모니마트', /^하모니마트/], ['홈마트', /^홈마트/]
];
export function chainOf(store) {
    const s = String(store || '').trim();
    for (const [name, re] of CHAINS) if (re.test(s)) return name;
    return (s.split(/\s+/)[0] || '기타').replace(/[(（].*$/, '') || '기타';
}
const dateOfTitle = t => {   // '…_20261023' 또는 '…_09/24/2021'
    let m = String(t).match(/(\d{4})(\d{2})(\d{2})\s*$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = String(t).match(/(\d{2})\/(\d{2})\/(\d{4})\s*$/); if (m) return `${m[3]}-${m[1]}-${m[2]}`;
    return null;
};
const codeOf = name => { let h = 2166136261; for (const c of String(name)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return 'CG' + h.toString(36).toUpperCase().padStart(7, '0'); };
const q25 = a => { a = a.slice().sort((x, y) => x - y); if (!a.length) return null; const pos = (a.length - 1) * 0.25, lo = Math.floor(pos), hi = Math.ceil(pos); return a[lo] + (a[hi] - a[lo]) * (pos - lo); };

// 상품명 → 품목·카테고리 (config/chamgagyeok-items.json)
export function classify(name, cfg) {
    const n = String(name).replace(/\s+/g, '');
    for (const it of cfg.items) if (it.kw.some(k => n.includes(k.replace(/\s+/g, '')))) return { item: it.item, cat: it.cat, matched: true };
    return { item: cfg.fallback.food.item, cat: 'food', matched: false };
}

async function snapshots() {
    const d = await fetchJSON(DOCS);
    return Object.entries(d.paths || {}).map(([p, v]) => ({ uddi: p.split('/').pop(), title: v.get?.summary || '', date: dateOfTitle(v.get?.summary || '') }))
        .filter(s => s.date && s.uddi.startsWith('uddi:')).sort((a, b) => a.date.localeCompare(b.date));
}
async function fetchAll(key, uddi) {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
        const u = `${API}/${NS}/${uddi}?page=${page}&perPage=${PER_PAGE}&returnType=JSON&serviceKey=${encodeURIComponent(key)}`;
        const d = await fetchJSON(u, { timeout: 60000 });
        if (d.code && d.code < 0) throw new Error(`참가격 API ${d.code}: ${d.msg || ''}`);
        const data = Array.isArray(d.data) ? d.data : [];
        rows.push(...data);
        if (!data.length || rows.length >= (d.matchCount ?? d.totalCount ?? Infinity) || data.length < PER_PAGE) break;
        await sleep(150);
    }
    return rows;
}
const pickCol = (r, names) => { for (const n of names) if (r[n] != null && r[n] !== '') return r[n]; return null; };
const rowOf = r => ({
    name: String(pickCol(r, ['상품명', 'GOOD_NAME']) || '').trim(),
    date: String(pickCol(r, ['조사일', 'GOOD_INSPECT_DAY']) || '').slice(0, 10).replace(/\./g, '-'),
    price: Number(String(pickCol(r, ['판매가격', 'GOOD_PRICE']) ?? '').replace(/[^0-9.]/g, '')),
    store: String(pickCol(r, ['판매업소', 'SORE_NAME', 'STORE_NAME']) || '').trim(),
    maker: String(pickCol(r, ['제조사', 'MANUFACTURE']) || '').trim(),
    sale: /^Y/i.test(String(pickCol(r, ['세일여부', 'SALE_YN']) || '')),
    one: /^Y/i.test(String(pickCol(r, ['원플러스원', 'ONEPLUSONE_YN']) || ''))
});

export async function run() {
    const key = env('DATA_GO_KR_KEY');
    if (!key) return { status: 'skipped', message: 'DATA_GO_KR_KEY가 없어 건너뛰었어요.' };
    const cfg = readJSON('config/chamgagyeok-items.json');
    const prev = exists(meta.file) ? readJSON(meta.file) : null;
    const list = (await snapshots()).slice(-KEEP);
    if (!list.length) throw new Error('참가격 자료 목록을 받지 못했어요.');
    const latest = list[list.length - 1];

    // 월 중간값: 이전에 모은 자료는 그대로 쓰고, 새 자료만 받음
    const monthly = { ...(prev?.monthly || {}) };     // uddi → { date, med: { name: median } }
    Object.keys(monthly).forEach(u => { if (!list.some(s => s.uddi === u)) delete monthly[u]; });
    let latestRows = null, calls = 0;
    for (const s of list) {
        const need = !monthly[s.uddi] || (s.uddi === latest.uddi && prev?.latest?.uddi !== latest.uddi);
        if (!need) continue;
        const rows = (await fetchAll(key, s.uddi)).map(rowOf).filter(r => r.name && r.price > 0);
        calls++;
        if (!rows.length) throw new Error(`${s.date} 자료가 비어 있어요. 활용신청이 승인됐는지 확인하세요.`);
        const by = {};
        rows.forEach(r => { (by[r.name] = by[r.name] || []).push(r.price); });
        monthly[s.uddi] = { date: s.date, med: Object.fromEntries(Object.entries(by).map(([n, ps]) => [n, Math.round(median(ps))])) };
        if (s.uddi === latest.uddi) latestRows = rows;
    }

    // 최신 자료가 바뀌지 않았으면 상품 요약은 이전 것을 쓰고 추이만 갱신
    let products;
    if (!latestRows && prev?.products && prev.latest?.uddi === latest.uddi) products = prev.products;
    else {
        if (!latestRows) { latestRows = (await fetchAll(key, latest.uddi)).map(rowOf).filter(r => r.name && r.price > 0); calls++; }
        const by = {};
        latestRows.forEach(r => { (by[r.name] = by[r.name] || { maker: r.maker, rows: [] }).rows.push(r); });
        products = Object.entries(by).map(([name, o]) => {
            const dates = [...new Set(o.rows.map(r => r.date))].sort();
            const last = dates[dates.length - 1], lastRows = o.rows.filter(r => r.date === last);
            const chains = {};
            lastRows.forEach(r => { const c = chainOf(r.store); (chains[c] = chains[c] || []).push(r); });
            const { item, cat, matched } = classify(name, cfg);
            return {
                code: codeOf(name), name, maker: o.maker, item, category: cat, matched,
                surveyDates: dates, median: Object.fromEntries(dates.map(d => [d, Math.round(median(o.rows.filter(r => r.date === d).map(r => r.price)))])),
                p25: Math.round(q25(lastRows.map(r => r.price))), stores: lastRows.length,
                chains: Object.entries(chains).map(([c, rs]) => { const ps = rs.map(r => r.price); return [c, rs.length, Math.round(median(ps)), Math.min(...ps), Math.max(...ps), rs.filter(r => r.sale || r.one).length]; })
                    .sort((a, b) => b[1] - a[1])
            };
        }).filter(p => p.stores >= 1).sort((a, b) => b.stores - a.stores);
    }
    // 상품별 월 추이 (자료 날짜 순)
    const order = list.filter(s => monthly[s.uddi]).map(s => s.uddi);
    const months = order.map(u => monthly[u].date);
    products.forEach(p => { p.history = order.map(u => monthly[u].med[p.name] ?? null); });

    const chainsAll = {};
    products.forEach(p => p.chains.forEach(c => { chainsAll[c[0]] = (chainsAll[c[0]] || 0) + c[1]; }));
    const unmatched = products.filter(p => !p.matched).map(p => p.name);
    return {
        status: 'ok', count: products.length,
        message: `상품 ${products.length}개 · 판매처 체인 ${Object.keys(chainsAll).length}곳 · ${latest.date} 자료${calls ? '' : ' (변경 없음)'}${unmatched.length ? ` · 품목 미분류 ${unmatched.length}개` : ''}`,
        data: { latest: { uddi: latest.uddi, date: latest.date, title: latest.title }, months, chains: Object.entries(chainsAll).sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ chain: c, rows: n })),
            columns: { chains: ['chain', 'stores', 'median', 'min', 'max', 'sale_stores'] }, unmatched: unmatched.slice(0, 300), products, monthly }
    };
}
