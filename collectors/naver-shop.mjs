// 커머스 · API — 네이버 쇼핑 검색 API
// 실제 가격 상품(참가격 60개)을 상품명으로 검색해 쇼핑몰별 최저가·상품 링크·이미지를 모아요.
// 필요한 Secrets: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET (developers.naver.com 애플리케이션 등록 → 검색 API)
import { products, mapping, readJSON, exists, fetchJSON, similarity, sizeTokens, clean, sleep, env } from './lib.mjs';

export const meta = { id: 'naver_shop', name: '네이버 쇼핑 검색 API', kind: 'commerce', type: 'api', provider: '네이버 (developers.naver.com)', file: 'data/commerce/api/naver-shop.json',
    note: '쇼핑몰별 최저가·상품 링크·대표 이미지. 이미지 저작권은 각 판매처에 있어요.' };

const normSize = s => s.toLowerCase().replace(/\s/g, '');
function sizeOk(name, title) {
    const toks = sizeTokens(name);
    if (!toks.length) return true;
    const t = normSize(clean(title));
    return toks.every(tok => {
        const m = tok.match(/^([\d.]+)(.*)$/); if (!m) return true;
        const [, n, unit] = m;
        if (!unit) return t.includes(n);
        if (/개입|개|입/.test(unit)) return new RegExp(`${n.replace('.', '\\.')}(개|입|봉|팩)`).test(t);
        return t.includes(n + unit.slice(0, 1)) || t.includes(n + unit);
    });
}

export async function run() {
    const id = env('NAVER_CLIENT_ID'), secret = env('NAVER_CLIENT_SECRET');
    if (!id || !secret) return { status: 'skipped', message: 'NAVER_CLIENT_ID / NAVER_CLIENT_SECRET이 없어 건너뛰었어요.' };
    const cfg = mapping().naver, malls = cfg.malls.map(([k, re, label]) => ({ key: k, re: new RegExp(re, 'i'), label }));
    const mallOf = name => malls.find(m => m.re.test(name)) || { key: cfg.etc[0], label: cfg.etc[1] };
    const ref = exists('data/commerce/db/chamgagyeok-csv.json') ? Object.fromEntries(readJSON('data/commerce/db/chamgagyeok-csv.json').products.map(p => [p.code, p.median_20261023])) : {};
    const targets = products().filter(p => p.real);
    const out = {}, errors = [];
    for (const p of targets) {
        const q = p.name.replace(/\(([^)]*)\)\s*$/, ' $1').replace(/\s+/g, ' ').trim();
        try {
            const data = await fetchJSON(`https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(q)}&display=40&sort=sim&exclude=used:rental`,
                { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret } });
            const base = ref[p.code];
            const items = (data.items || []).map(it => {
                const title = clean(it.title), price = Number(it.lprice) || 0, score = similarity(p.name, title);
                const ratio = base ? price / base : 1, sz = sizeOk(p.name, title), priceOk = ratio >= 0.4 && ratio <= 2.5;
                const m = mallOf(it.mallName || '');
                return { mall: m.key, mallLabel: m.label, mallName: it.mallName || '', title, price, link: it.link, image: it.image, productId: it.productId, productType: Number(it.productType) || 0,
                    brand: it.brand || '', maker: it.maker || '', score, sizeOk: sz,
                    status: score >= 0.6 && sz && priceOk ? 'auto' : score >= 0.45 ? 'pending' : 'none',
                    note: [!sz && '용량·개수 표기가 달라요', !priceOk && `가격이 참가격의 ${Math.round(ratio * 100)}%`].filter(Boolean).join(' · ') };
            }).filter(it => it.price > 0 && it.status !== 'none');
            const byMall = {};
            for (const it of items.filter(i => i.status === 'auto').sort((a, b) => a.price - b.price)) if (!byMall[it.mall]) byMall[it.mall] = it;
            const best = items.filter(i => i.status === 'auto').sort((a, b) => b.score - a.score)[0];
            out[p.code] = { name: p.name, query: q, image: best?.image || '', imageFrom: best ? best.mallName : '', offers: Object.values(byMall), pending: items.filter(i => i.status === 'pending').slice(0, 5) };
        } catch (e) { errors.push(`${p.name}: ${e.message}`); if (errors.length >= 3 && !Object.keys(out).length) break; }
        await sleep(120);   // 초당 10회 이하
    }
    if (!Object.keys(out).length) throw new Error(errors[0] || '결과가 없어요.');
    const offers = Object.values(out).reduce((a, p) => a + p.offers.length, 0);
    return { status: 'ok', count: offers, message: `상품 ${Object.keys(out).length}개 · 쇼핑몰 가격 ${offers}건${errors.length ? ` · 오류 ${errors.length}건` : ''}`,
        data: { malls: [...malls.map(m => ({ key: m.key, label: m.label })), { key: cfg.etc[0], label: cfg.etc[1] }], products: out } };
}
