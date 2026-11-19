// 유통 · API — KAMIS 농축수산물 소매가격 (한국농수산식품유통공사)
// 최근 7개월 매달 15일 기준 소매가격 → 품목별 가격 지수(마지막 달 = 100)
// 필요한 Secrets: KAMIS_CERT_KEY, KAMIS_CERT_ID (kamis.or.kr 회원가입 → Open-API 신청)
import { mapping, fetchJSON, num, median, lastMonths, sleep, env } from './lib.mjs';

export const meta = { id: 'kamis', name: 'KAMIS 농축수산물 소매가격', kind: 'distribution', type: 'api', provider: '한국농수산식품유통공사 (kamis.or.kr)', file: 'data/distribution/api/kamis.json',
    note: '식품 원재료비 변동률 (쌀·콩·감자·축산물 등)' };

export async function run() {
    const key = env('KAMIS_CERT_KEY'), cid = env('KAMIS_CERT_ID');
    if (!key || !cid) return { status: 'skipped', message: 'KAMIS_CERT_KEY / KAMIS_CERT_ID가 없어 건너뛰었어요.' };
    const cfg = mapping().kamis, months = lastMonths(7);
    const today = new Date().toISOString().slice(0, 10);
    const raw = {};   // 품목|품종|등급 → {item, unit, values:{month:price}}
    let calls = 0, errors = [];
    for (const m of months) {
        const regday = `${m}-15` > today ? new Date(Date.now() - 86400000).toISOString().slice(0, 10) : `${m}-15`;
        for (const cat of Object.keys(cfg.categories)) {
            const u = new URL('https://www.kamis.or.kr/service/price/xml.do');
            Object.entries({ action: 'dailyPriceByCategoryList', p_product_cls_code: cfg.product_cls_code, p_item_category_code: cat, p_country_code: '', p_regday: regday,
                p_convert_kg_yn: 'N', p_cert_key: key, p_cert_id: cid, p_returntype: 'json' }).forEach(([k, v]) => u.searchParams.set(k, v));
            try {
                const d = await fetchJSON(u.toString()); calls++;
                const rows = Array.isArray(d?.data?.item) ? d.data.item : [];
                if (!rows.length && d?.data?.error_code && d.data.error_code !== '000' && d.data.error_code !== '001') throw new Error(`KAMIS 오류 ${d.data.error_code}`);
                rows.forEach(r => {
                    const price = num(r.dpr1); if (price == null) return;
                    const k = `${r.item_name}|${r.kind_name}|${r.rank}`;
                    (raw[k] = raw[k] || { item: String(r.item_name).trim(), category: cfg.categories[cat], unit: r.unit, values: {} }).values[m] = price;
                });
            } catch (e) { errors.push(`${m} ${cat}: ${e.message}`); if (errors.length >= 4 && !calls) throw e; }
            await sleep(200);
        }
    }
    // 품종·등급별 지수(마지막 달 = 100)를 품목별 중앙값으로 묶음
    const byItem = {};
    Object.values(raw).forEach(r => {
        const last = months.map(m => r.values[m]).filter(v => v != null).pop();
        if (!last) return;
        (byItem[r.item] = byItem[r.item] || { category: r.category, idx: [] }).idx.push(months.map(m => r.values[m] != null ? r.values[m] / last * 100 : null));
    });
    const series = {};
    Object.entries(byItem).forEach(([item, o]) => {
        series[item] = { label: `${item} (${o.category}) 소매가격 지수`, unit: 'index', values: months.map((_, i) => { const v = median(o.idx.map(a => a[i])); return v == null ? null : Math.round(v * 10) / 10; }), kinds: o.idx.length };
    });
    if (!Object.keys(series).length) throw new Error(errors[0] || '가격 자료가 없어요.');
    return { status: 'ok', count: Object.keys(series).length, message: `품목 ${Object.keys(series).length}개 · ${months[0]}~${months[months.length - 1]}${errors.length ? ` · 오류 ${errors.length}건` : ''}`, data: { months, series } };
}
