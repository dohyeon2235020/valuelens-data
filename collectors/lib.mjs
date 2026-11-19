// 수집 공통 함수 (Node 20 이상, 외부 패키지 없음)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const readJSON = rel => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
export const exists = rel => existsSync(join(ROOT, rel));
export function writeJSON(rel, obj) {
    const p = join(ROOT, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(obj, null, 1) + '\n');
}
export const products = () => readJSON('config/products.json').products;
export const mapping = () => readJSON('config/mapping.json');
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const env = k => (process.env[k] || '').trim();

// 실패해도 두 번 더 시도 (429·5xx). 키는 로그에 남기지 않음
export async function fetchText(url, opts = {}, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
        try {
            const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
            const res = await fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
            const text = await res.text();
            if (res.status === 429 || res.status >= 500) { last = new Error(`HTTP ${res.status}`); await sleep(1500 * (i + 1)); continue; }
            if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`), { fatal: true });
            return text;
        } catch (e) { if (e.fatal) throw e; last = e; await sleep(1000 * (i + 1)); }
    }
    throw last;
}
export async function fetchJSON(url, opts, tries) {
    const t = await fetchText(url, opts, tries);
    try { return JSON.parse(t); } catch (e) { throw new Error(`JSON이 아닌 응답: ${t.slice(0, 160)}`); }
}
// 아주 단순한 XML 파서: <item> 안의 자식 태그를 객체로
export function xmlItems(xml, tag = 'item') {
    const out = [], re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    let m;
    while ((m = re.exec(xml))) {
        const o = {}, cre = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
        let c; while ((c = cre.exec(m[1]))) o[c[1]] = c[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        out.push(o);
    }
    return out;
}
export const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' && String(v).trim() !== '-' ? n : null; };
export const median = a => { a = a.filter(v => v != null).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// 최근 n개월 (YYYY-MM), 오래된 것부터
export function lastMonths(n, from = new Date()) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1)); out.push(d.toISOString().slice(0, 7)); }
    return out;
}

// 상품명 유사도 (ValueLens 사이트와 같은 규칙)
const stripTags = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const clean = stripTags;
const normText = s => stripTags(s).toLowerCase().replace(/[\s\[\](){}<>.,·/\\_\-+*'"!?:;~|]/g, '');
function bigrams(s) { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; }
export function similarity(ours, title) {
    const a = normText(ours), b = normText(title);
    if (!a || !b) return 0;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0; A.forEach((n, k) => { inter += Math.min(n, B.get(k) || 0); });
    const dice = (2 * inter) / Math.max(1, (a.length - 1) + (b.length - 1));
    const words = String(ours).replace(/\(.*?\)/g, ' ').split(/\s+/).map(normText).filter(w => w.length >= 2);
    const cover = words.length ? words.filter(w => b.includes(w)).length / words.length : 0;
    return Math.round(Math.max(dice, 0.35 * dice + 0.65 * cover) * 100) / 100;
}
// 용량·개수 표기 (예: 500g, 5개입, 2.1L) — 같은 상품인지 판단할 때 씀
export function sizeTokens(name) {
    const m = String(name).match(/\(([^)]*)\)\s*$/);
    if (!m) return [];
    return m[1].split(/[,\s]+/).map(s => s.toLowerCase().replace(/\s/g, '')).filter(s => /\d/.test(s));
}
