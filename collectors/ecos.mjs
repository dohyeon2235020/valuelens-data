// 유통 · API — 한국은행 ECOS 생산자물가지수
// 카테고리별(음식료품·섬유·화학 등) 지수와 운송 서비스 지수 → 원재료비 기본값·포장물류비 변동률
// 필요한 Secret: ECOS_KEY (ecos.bok.or.kr 인증키 신청)
import { mapping, fetchJSON, num, lastMonths, sleep, env } from './lib.mjs';

export const meta = { id: 'ecos', name: '한국은행 생산자물가지수', kind: 'distribution', type: 'api', provider: '한국은행 ECOS (ecos.bok.or.kr)', file: 'data/distribution/api/ecos.json',
    note: '카테고리별 생산자물가(원재료비 기본값) · 운송 서비스 물가(포장·물류비)' };

export async function run() {
    const key = env('ECOS_KEY');
    if (!key) return { status: 'skipped', message: 'ECOS_KEY가 없어 건너뛰었어요.' };
    const cfg = mapping().ecos, months = lastMonths(9), start = months[0].replace('-', ''), end = months[months.length - 1].replace('-', '');
    const base = `https://ecos.bok.or.kr/api`;
    const list = await fetchJSON(`${base}/StatisticItemList/${encodeURIComponent(key)}/json/kr/1/2000/${cfg.stat_code}`);
    if (list.RESULT) throw new Error(`ECOS ${list.RESULT.CODE}: ${list.RESULT.MESSAGE}`);
    const items = (list.StatisticItemList?.row || []).filter(r => !r.CYCLE || r.CYCLE === 'M');
    const pick = names => { for (const n of names) { const c = items.filter(r => String(r.ITEM_NAME).replace(/\s/g, '').includes(n)).sort((a, b) => String(a.ITEM_NAME).length - String(b.ITEM_NAME).length)[0]; if (c) return c; } return null; };
    const want = { ...Object.fromEntries(Object.entries(cfg.groups).map(([g, names]) => [g, pick(names)])), logistics: pick(cfg.logistics.names) };
    const series = {}, errors = [];
    for (const [g, it] of Object.entries(want)) {
        if (!it) { errors.push(`${g}: 항목을 찾지 못했어요`); continue; }
        try {
            const d = await fetchJSON(`${base}/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/100/${cfg.stat_code}/M/${start}/${end}/${it.ITEM_CODE}`);
            if (d.RESULT) throw new Error(`${d.RESULT.CODE}: ${d.RESULT.MESSAGE}`);
            const byMonth = Object.fromEntries((d.StatisticSearch?.row || []).map(r => [`${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}`, num(r.DATA_VALUE)]));
            const vals = months.map(m => byMonth[m] ?? null), last = vals.filter(v => v != null).pop();
            if (last) series[g] = { label: `생산자물가 ${it.ITEM_NAME}`, unit: 'index', itemCode: it.ITEM_CODE, raw: vals, values: vals.map(v => v == null ? null : Math.round(v / last * 1000) / 10) };
        } catch (e) { errors.push(`${g}: ${e.message}`); }
        await sleep(150);
    }
    let lastIdx = months.length - 1;
    while (lastIdx > 0 && !Object.values(series).some(s => s.values[lastIdx] != null)) lastIdx--;
    const from = Math.max(0, lastIdx - 6);
    Object.values(series).forEach(s => { s.values = s.values.slice(from, lastIdx + 1); s.raw = s.raw.slice(from, lastIdx + 1); });
    if (!Object.keys(series).length) throw new Error(errors[0] || '자료가 없어요.');
    return { status: 'ok', count: Object.keys(series).length, message: `지수 ${Object.keys(series).length}개${errors.length ? ` · 못 찾음 ${errors.length}건` : ''}`, data: { months: months.slice(from, lastIdx + 1), series } };
}
