// 유통 · API — 통계청 KOSIS 임금 통계 (공임·노임 변동률)
// 기본: 고용노동부 사업체노동력조사 '산업/규모별 임금 및 근로시간'(118 / DT_118N_MON054)의 제조업 · 전규모 월 임금총액
// 필요한 Secret: KOSIS_KEY (kosis.kr/openapi 인증키)
// 다른 통계표를 쓰려면 config/mapping.json의 kosis.params 또는 저장소 변수 KOSIS_PARAMS(JSON)를 바꿔요.
//   자동: {"orgId":"118","tblId":"DT_118N_MON054","prdSe":"M","auto":{"item":["임금총액"],"pick":["제조업","전규모"]}}
//   직접: {"orgId":"118","tblId":"…","itmId":"…","objL1":"…","objL2":"…","prdSe":"M"}
import { mapping, fetchJSON, num, lastMonths, env } from './lib.mjs';

export const meta = { id: 'kosis', name: '통계청 제조업 월평균 임금', kind: 'distribution', type: 'api', provider: '통계청 KOSIS · 고용노동부 사업체노동력조사', file: 'data/distribution/api/kosis.json',
    note: '공임·노임 변동률 (제조업 월 임금총액)' };

const KOSIS = 'https://kosis.kr/openapi';
async function kosisJSON(url) {
    const d = await fetchJSON(url);
    if (d && !Array.isArray(d) && (d.err || d.errMsg)) throw new Error(`KOSIS ${d.err || ''} ${d.errMsg || ''}`.trim());
    return d;
}
// 통계표 항목·분류 목록에서 이름으로 코드를 고름
async function autoParams(key, p) {
    const metaUrl = `${KOSIS}/statisticsData.do?method=getMeta&type=ITM&apiKey=${encodeURIComponent(key)}&orgId=${p.orgId}&tblId=${p.tblId}&format=json&jsonVD=Y`;
    const rows = await kosisJSON(metaUrl);
    if (!Array.isArray(rows) || !rows.length) throw new Error('통계표 항목 정보를 받지 못했어요.');
    const groups = {};
    rows.forEach(r => { (groups[r.OBJ_ID] = groups[r.OBJ_ID] || { sn: Number(r.OBJ_ID_SN) || 0, name: r.OBJ_NM, list: [] }).list.push(r); });
    const nm = s => String(s || '').replace(/\s/g, '');
    const pickFrom = (list, words) => {
        for (const w of words) { const hit = list.find(r => nm(r.ITM_NM) === nm(w)) || list.find(r => nm(r.ITM_NM).startsWith(nm(w))) || list.filter(r => nm(r.ITM_NM).includes(nm(w))).sort((x, y) => nm(x.ITM_NM).length - nm(y.ITM_NM).length)[0]; if (hit) return hit; }
        return list.find(r => /^(전체|계|합계|전산업|전규모)/.test(nm(r.ITM_NM))) || list[0];
    };
    const itemGroup = groups.ITEM || Object.values(groups).find(g => /항목/.test(g.name));
    if (!itemGroup) throw new Error('항목(ITEM)을 찾지 못했어요.');
    const item = pickFrom(itemGroup.list, p.auto.item || []);
    const out = { orgId: p.orgId, tblId: p.tblId, prdSe: p.prdSe || 'M', itmId: item.ITM_ID }, chosen = [`항목 ${item.ITM_NM}`];
    Object.entries(groups).filter(([id]) => id !== 'ITEM' && groups[id] !== itemGroup).sort((a, b) => a[1].sn - b[1].sn).forEach(([, g], i) => {
        const c = pickFrom(g.list, p.auto.pick || []);
        out[`objL${i + 1}`] = c.ITM_ID; chosen.push(`${g.name} ${c.ITM_NM}`);
    });
    return { params: out, chosen };
}

export async function run() {
    const key = env('KOSIS_KEY');
    if (!key) return { status: 'skipped', message: 'KOSIS_KEY가 없어 건너뛰었어요.' };
    let p = mapping().kosis.params;
    if (env('KOSIS_PARAMS')) { try { p = JSON.parse(env('KOSIS_PARAMS')); } catch (e) { throw new Error('KOSIS_PARAMS가 JSON 형식이 아니에요.'); } }
    if (!p) return { status: 'needs-config', message: '쓸 임금 통계표(KOSIS_PARAMS)를 아직 정하지 않아 건너뛰었어요.' };
    let chosen = [];
    if (p.auto) { const a = await autoParams(key, p); p = a.params; chosen = a.chosen; }
    const months = lastMonths(12), start = months[0].replace('-', ''), end = months[months.length - 1].replace('-', '');
    const u = new URL(p.userStatsId ? `${KOSIS}/statisticsData.do` : `${KOSIS}/Param/statisticsParameterData.do`);
    Object.entries({ method: 'getList', apiKey: key, format: 'json', jsonVD: 'Y', prdSe: p.prdSe || 'M', startPrdDe: start, endPrdDe: end, ...p }).forEach(([k, v]) => u.searchParams.set(k, v));
    const d = await kosisJSON(u.toString());
    if (!Array.isArray(d)) throw new Error(`KOSIS 오류: ${JSON.stringify(d).slice(0, 160)}`);
    const byMonth = {};
    d.forEach(r => { const t = String(r.PRD_DE || ''); const ym = `${t.slice(0, 4)}-${t.slice(4, 6)}`; const v = num(r.DT); if (v != null && /^\d{4}-\d{2}$/.test(ym)) byMonth[ym] = v; });
    const have = months.filter(m => byMonth[m] != null).slice(-7);
    if (!have.length) throw new Error('임금 자료가 없어요. 통계표 설정을 확인하세요.');
    const last = byMonth[have[have.length - 1]];
    return { status: 'ok', count: have.length, message: `${have[0]}~${have[have.length - 1]} 임금 ${have.length}개월${chosen.length ? ` (${chosen.join(', ')})` : ''}`,
        data: { months: have, table: { orgId: p.orgId, tblId: p.tblId, chosen }, series: { wage: { label: `제조업 월 임금총액 (${d[0]?.TBL_NM || 'KOSIS'})`, unit: 'index', valueLast: last, values: have.map(m => Math.round(byMonth[m] / last * 1000) / 10) } } } };
}
