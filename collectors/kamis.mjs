// 유통 · API — KAMIS 농축수산물 가격 (한국농수산식품유통공사, 공공데이터포털 '일별 도,소매 가격정보 조회')
// 최근 7개월 매달 중순(10~16일) 가격 → 품목별 가격 지수(마지막 달 = 100)
// 필요한 Secret: DATA_GO_KR_KEY (관세청 API와 같은 공공데이터포털 일반 인증키 Decoding)
import { mapping, fetchText, xmlItems, num, median, lastMonths, sleep, env } from './lib.mjs';

export const meta = { id: 'kamis', name: 'KAMIS 농축수산물 가격', kind: 'distribution', type: 'api', provider: '한국농수산식품유통공사 · data.go.kr 일별 도,소매 가격정보', file: 'data/distribution/api/kamis.json',
    note: '식품 원재료비 변동률 (쌀·콩·감자·축산물 등)' };

const ENDPOINT = 'https://apis.data.go.kr/B552845/perDay/price';
// 품목 코드가 있어야 결과가 나와요 (부류코드 → [품목코드, 이름]). config/mapping.json의 kamis.items로 바꿀 수 있어요
const DEFAULT_ITEMS = { '100': [['111', '쌀'], ['141', '콩'], ['152', '감자']], '500': [['4301', '쇠고기'], ['4304', '돼지고기'], ['9901', '닭고기']] };

// 응답(JSON 또는 XML)에서 행 목록 찾기
function rowsOf(text) {
    const t = text.trim();
    if (t.startsWith('<')) {
        const msg = (t.match(/<(returnAuthMsg|resultMsg)>([^<]*)/) || [])[2];
        const code = (t.match(/<resultCode>([^<]*)/) || [])[1];
        const rows = xmlItems(t);
        if (!rows.length && (msg && !/NORMAL|정상|성공/i.test(msg) || code && !/^0+$/.test(code))) throw new Error(msg || `오류 ${code}`);
        return { rows, total: num((t.match(/<totalCount>([^<]*)/) || [])[1]) };
    }
    const d = JSON.parse(t);
    const hdr = d?.response?.header || d?.header || {};
    let rows = [], total = null;
    (function walk(o) {
        if (!o || typeof o !== 'object' || rows.length) return;
        if (Array.isArray(o)) { if (o.length && typeof o[0] === 'object' && !Array.isArray(o[0])) { rows = o; return; } o.forEach(walk); return; }
        if (total == null && o.totalCount != null) total = num(o.totalCount);
        Object.values(o).forEach(walk);
    })(d?.response?.body || d?.body || d);
    // item이 1개일 때 배열이 아닌 객체로 오는 경우
    if (!rows.length) { const it = (d?.response?.body || d?.body)?.items?.item; if (it && typeof it === 'object' && !Array.isArray(it)) rows = [it]; }
    if (!rows.length && hdr.resultCode && !/^0+$/.test(String(hdr.resultCode))) throw new Error(`${hdr.resultCode} ${hdr.resultMsg || ''}`.trim());
    return { rows, total };
}

// 행에서 가격 칸 고르기: 이름에 prc/price가 들어간 숫자 칸 (평균가 우선)
function priceKey(row) {
    const ks = Object.keys(row).filter(k => /prc|price|pric/i.test(k) && !/_cd$|unit|nm$/i.test(k) && num(row[k]) != null);
    // 환산가(cnvs)는 축산물에서 값이 틀리게 오는 경우가 있어 조사 가격을 먼저 씀 (단위별로 따로 지수를 내므로 환산이 필요 없음)
    return ks.find(k => /dd_prc$/i.test(k) && !/cnvs/i.test(k)) || ks.find(k => /avg/i.test(k)) || ks.find(k => /cnvs/i.test(k)) || ks[0];
}
const pickKey = (row, re) => Object.keys(row).find(k => re.test(k));

export async function run() {
    const key = env('DATA_GO_KR_KEY');
    if (!key) return { status: 'skipped', message: 'DATA_GO_KR_KEY가 없어 건너뛰었어요.' };
    const cfg = mapping().kamis, months = lastMonths(7);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const raw = {};   // 구분|품목|품종|등급 → {item, se, values:{month:[prices]}}
    let calls = 0, sample = null; const errors = [];
    for (const m of months) {
        let to = `${m}-16`, from = `${m}-10`;
        if (to > yest) { to = yest; const f = new Date(Date.parse(yest) - 6 * 86400000).toISOString().slice(0, 10); from = f; }
        for (const [cat, list] of Object.entries(cfg.items || DEFAULT_ITEMS)) for (const [itemCd] of list) {
            for (let page = 1; page <= 30; page++) {
                const q = new URLSearchParams({ pageNo: page, numOfRows: 1000, 'cond[exmn_ymd::GTE]': from.replace(/-/g, ''), 'cond[exmn_ymd::LTE]': to.replace(/-/g, ''), 'cond[ctgry_cd::EQ]': cat, 'cond[item_cd::EQ]': itemCd, returnType: 'JSON' });
                const u = `${ENDPOINT}?serviceKey=${encodeURIComponent(key)}&${q.toString()}`;
                try {
                    const { rows, total } = rowsOf(await fetchText(u)); calls++;
                    if (rows.length && !sample) sample = rows[0];
                    rows.forEach(r => {
                        const pk = priceKey(r); if (!pk) return;
                        const price = num(r[pk]); if (!price) return;
                        const item = String(r[pickKey(r, /^item_?nm$/i)] ?? r[pickKey(r, /item.*nm|품목/i)] ?? '').trim(); if (!item) return;
                        const se = String(r[pickKey(r, /^se_?nm$/i)] ?? r[pickKey(r, /^se_?cd$/i)] ?? '').trim();
                        const kind = r[pickKey(r, /vrty.*nm/i)] ?? r[pickKey(r, /vrty.*cd/i)] ?? '';
                        const grd = r[pickKey(r, /grd.*nm/i)] ?? r[pickKey(r, /grd.*cd/i)] ?? '';
                        const unit = `${r.unit_sz ?? ''}${r.unit ?? r[pickKey(r, /unit/i)] ?? ''}`;
                        const k = `${se}|${item}|${kind}|${grd}|${unit}`;
                        ((raw[k] = raw[k] || { item, se, category: cfg.categories[cat], values: {} }).values[m] = raw[k].values[m] || []).push(price);
                    });
                    if (rows.length < 1000 || (total != null && page * 1000 >= total)) break;
                } catch (e) { errors.push(`${m} ${cat}/${itemCd}: ${e.message}`); if (errors.length >= 4 && !calls) throw e; break; }
                await sleep(120);
            }
        }
    }
    // 소매가격 행이 있으면 소매만 씀 (판매가 쪽 변동률), 없으면 전부
    const all = Object.values(raw), retail = all.filter(r => /소매/.test(r.se));
    const use = retail.length ? retail : all;
    // 품종·등급별 지수(마지막 달 = 100)를 품목별 중앙값으로 묶음
    const byItem = {};
    use.forEach(r => {
        const v = months.map(m => r.values[m] ? median(r.values[m]) : null);
        const last = v.filter(x => x != null).pop(); if (!last) return;
        (byItem[r.item] = byItem[r.item] || { category: r.category, idx: [] }).idx.push(v.map(x => x != null ? x / last * 100 : null));
    });
    const series = {};
    Object.entries(byItem).forEach(([item, o]) => {
        series[item] = { label: `${item} (${o.category}) ${retail.length ? '소매' : '도·소매'}가격 지수`, unit: 'index', values: months.map((_, i) => { const v = median(o.idx.map(a => a[i])); return v == null ? null : Math.round(v * 10) / 10; }), kinds: o.idx.length };
    });
    // 응답 칸 이름 기록 (값은 남기지 않음) — 형식이 바뀌었을 때 확인용
    const fields = sample ? Object.keys(sample) : [];
    if (!Object.keys(series).length) {
        // 한 건도 없으면: 조건을 바꿔 가며 건수만 확인해 기록 (키는 지움)
        const base = { 'cond[exmn_ymd::GTE]': '20251204', 'cond[exmn_ymd::LTE]': '20251204' };
        const tries = {
            예시날짜_쌀: { 'cond[exmn_ymd::GTE]': '20251204', 'cond[exmn_ymd::LTE]': '20251204', 'cond[ctgry_cd::EQ]': '100', 'cond[item_cd::EQ]': '111' },
            최근7일_쌀: { 'cond[exmn_ymd::GTE]': new Date(Date.parse(yest) - 6 * 86400000).toISOString().slice(0, 10).replace(/-/g, ''), 'cond[exmn_ymd::LTE]': yest.replace(/-/g, ''), 'cond[ctgry_cd::EQ]': '100', 'cond[item_cd::EQ]': '111' },
            올해_쌀: { 'cond[exmn_ymd::GTE]': '20260101', 'cond[exmn_ymd::LTE]': yest.replace(/-/g, ''), 'cond[ctgry_cd::EQ]': '100', 'cond[item_cd::EQ]': '111' },
        };
        const out = [];
        for (const [name, c] of Object.entries(tries)) {
            const q = new URLSearchParams({ pageNo: 1, numOfRows: 1, ...c, returnType: 'JSON' });
            let t = '';
            try { t = await fetchText(`${ENDPOINT}?serviceKey=${encodeURIComponent(key)}&${q.toString()}`); } catch (e) { t = 'ERR ' + e.message; }
            t = t.split(key).join('***').split(encodeURIComponent(key)).join('***');
            const tc = (t.match(/"totalCount"\s*:\s*"?(\d+)/) || [])[1];
            const it = (t.match(/"item"\s*:\s*\[(\{[^\]]{0,300})/) || [])[1];
            out.push(`${name}=${tc ?? t.replace(/\s+/g, ' ').slice(0, 120)}${it ? ' ' + it.slice(0, 300) : ''}`);
            await sleep(150);
        }
        throw new Error(`가격 자료가 없어요 (호출 ${calls}회, 행 ${Object.keys(raw).length}종${errors.length ? ', ' + errors[0] : ''}) · 시험: ${out.join(' | ')}`);
    }
    if (!Object.keys(series).length) throw new Error((errors[0] || '가격 자료가 없어요.') + (fields.length ? ` · 칸: ${fields.join(',')}` : ''));
    return { status: 'ok', count: Object.keys(series).length, message: `품목 ${Object.keys(series).length}개 · ${months[0]}~${months[months.length - 1]}${errors.length ? ` · 오류 ${errors.length}건` : ''}`, data: { months, priceField: sample ? priceKey(sample) : null, fields, series,
        // 확인용: 구분|품목|품종|등급|단위별 월 중앙값
        groups: Object.fromEntries(Object.entries(raw).map(([k, r]) => [k, months.map(m => r.values[m] ? Math.round(median(r.values[m])) : null)])) } };
}
