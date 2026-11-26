// 커머스 · API — 위키미디어 커먼스 품목 사진 (참가격 상품 이미지)
// 참가격에는 상품 사진이 없어서, 품목(예: 라면·우유·세제)마다 커먼스에서 자유 라이선스 사진을 하나 골라 붙여요.
// 브랜드 제품 사진이 아니라 품목을 보여 주는 일반 사진이에요. 저작자·라이선스를 함께 저장해 사이트에 표시해요.
// 키가 필요 없어요. 한 번 고른 사진은 다시 찾지 않아요 (config/chamgagyeok-items.json의 검색어를 바꾸면 다시 찾음).
import { readJSON, exists, fetchJSON, sleep } from './lib.mjs';

export const meta = { id: 'commons_images', name: '위키미디어 커먼스 품목 사진', kind: 'commerce', type: 'api', provider: 'Wikimedia Commons (commons.wikimedia.org)', file: 'data/commerce/api/commons-images.json',
    note: '참가격 상품의 품목별 대표 사진 · 저작자·라이선스 표시' };

const UA = { 'User-Agent': 'ValueLens-data/1.0 (https://github.com/dohyeon2235020/valuelens-data; student project)' };
const FREE = /^(CC0|Public domain|PD|CC BY(-SA)? ?[0-9.]+|CC BY(-SA)?$|Attribution|GFDL)/i;
const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();

// file이 정해져 있으면 그 파일을, 없으면 검색어로 찾은 첫 자유 라이선스 사진을 씀
async function search(term, file) {
    const q = new URLSearchParams(file ? { action: 'query', format: 'json', titles: 'File:' + file, prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '640', origin: '*' }
        : { action: 'query', format: 'json', generator: 'search', gsrsearch: `${term} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '12',
        prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '640', origin: '*' });
    const d = await fetchJSON(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: UA });
    const pages = Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const p of pages) {
        const ii = p.imageinfo?.[0]; if (!ii) continue;
        const md = ii.extmetadata || {}, lic = strip(md.LicenseShortName?.value);
        if (!/image\/(jpeg|png|webp)/.test(ii.mime || '') || !FREE.test(lic) || /NC|ND/.test(lic)) continue;
        if ((ii.width || 0) < 400 || (ii.height || 0) < 300) continue;
        return { image: ii.thumburl || ii.url, sourceUrl: ii.descriptionurl, title: p.title.replace(/^File:/, ''), artist: strip(md.Artist?.value).slice(0, 120) || '작자 미상', license: lic, term: file || term };
    }
    return null;
}

export async function run() {
    const cfg = readJSON('config/chamgagyeok-items.json');
    const prev = exists(meta.file) ? readJSON(meta.file) : { items: {} };
    const items = {};
    const want = [...cfg.items.map(i => [i.item, i.commons, i.file]), ...Object.values(cfg.fallback).map(f => [f.item, f.commons, f.file])];
    let found = 0, kept = 0, miss = [];
    for (const [item, term, file] of want) {
        const old = prev.items?.[item];
        if (old && old.term === (file || term)) { items[item] = old; kept++; continue; }
        try { const r = await search(term, file); if (r) { items[item] = r; found++; } else miss.push(item); }
        catch (e) { if (old) items[item] = old; miss.push(item); }
        await sleep(300);
    }
    if (!Object.keys(items).length) throw new Error('사진을 하나도 찾지 못했어요.');
    return { status: 'ok', count: Object.keys(items).length, message: `품목 사진 ${Object.keys(items).length}개 (새로 ${found} · 유지 ${kept}${miss.length ? ` · 못 찾음 ${miss.length}` : ''})`, data: { items, missing: miss } };
}
