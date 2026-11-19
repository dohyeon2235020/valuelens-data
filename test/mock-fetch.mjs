// 시험용: 실제 API 대신 가짜 응답을 돌려줘요. (node --import ./test/mock-fetch.mjs collect.mjs)
// 실제 데이터가 아니므로 이 결과를 data/에 커밋하지 마세요.
import { readFileSync } from 'node:fs';
const sum = JSON.parse(readFileSync(new URL('../data/commerce/db/chamgagyeok-csv.json', import.meta.url), 'utf8')).products;
const rnd = s => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 100003; return h / 100003; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const months = n => { const out = [], d = new Date(); for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7)); return out; };

globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.hostname === 'openapi.naver.com') {
        const q = u.searchParams.get('query'), p = sum.find(x => x.name.replace(/\(([^)]*)\)\s*$/, ' $1').replace(/\s+/g, ' ').trim() === q);
        if (!p) return json({ items: [] });
        const size = (p.name.match(/\(([^)]*)\)\s*$/) || [, ''])[1], base = p.name.replace(/\(.*\)\s*$/, '').trim();
        const malls = ['쿠팡', '11번가', 'G마켓', '네이버', 'SSG.COM', '옥션', '컬리', '작은가게몰'];
        const items = malls.map((m, i) => ({ title: `<b>${base}</b> ${size}`, link: `https://search.shopping.naver.com/mock/${p.code}/${i}`, image: `https://shopping-phinf.pstatic.net/mock/${p.code}.jpg`,
            lprice: String(Math.round(p.median_20261023 * (0.82 + rnd(p.code + m) * 0.4) / 10) * 10), hprice: '', mallName: m, productId: String(1000 + i), productType: i === 3 ? '1' : '2', brand: '', maker: '' }));
        items.push({ title: `${base} ${size} x 10개 묶음`, link: 'https://x/mock', image: '', lprice: String(p.median_20261023 * 9), mallName: '쿠팡', productId: '9', productType: '2' });
        return json({ total: items.length, items });
    }
    if (u.hostname === 'apis.data.go.kr' && u.pathname.startsWith('/B552845/perDay')) {
        // 공공데이터포털 '일별 도,소매 가격정보' (칸 이름은 추정)
        const cat = u.searchParams.get('cond[ctgry_cd::EQ]'), day = u.searchParams.get('cond[exmn_ymd::LTE]');
        const k = months(7).indexOf(day.slice(0, 4) + '-' + day.slice(4, 6));
        const names = [{ '111': '쌀', '141': '콩', '152': '감자', '4301': '쇠고기', '4304': '돼지고기', '9901': '닭고기' }[u.searchParams.get('cond[item_cd::EQ]')]].filter(Boolean);
        const item = names.flatMap(n => [['01', '소매'], ['02', '중도매']].map(([sc, sn]) => ({ exmn_ymd: day, se_cd: sc, se_nm: sn, ctgry_cd: cat, item_cd: '1', item_nm: n, vrty_nm: '일반', grd_nm: '상품', unit_nm: '1kg', exmn_dd_prc: String(Math.round(5000 * (1 + (k - 6) * 0.01 * (rnd(n) - 0.3)))) })));
        return json({ response: { header: { resultCode: '0', resultMsg: '정상' }, body: { items: { item }, numOfRows: 1000, pageNo: 1, totalCount: item.length } } });
    }
    if (u.hostname === 'apis.data.go.kr') {
        const hs = u.searchParams.get('hsSgn'), ms = months(9).slice(0, 7);
        const rows = ms.map((m, i) => `<item><year>${m.replace('-', '.')}</year><hsCd>${hs}</hsCd><impDlr>${Math.round(100000 * (1 + i * 0.02 * rnd(hs)))}</impDlr><impWgt>50000</impWgt><statKor>-</statKor></item>`).join('') + '<item><year>총계</year><impDlr>1</impDlr><impWgt>1</impWgt></item>';
        return new Response(`<response><header><resultCode>00</resultCode></header><body><items>${rows}</items></body></response>`, { status: 200 });
    }
    if (u.hostname === 'ecos.bok.or.kr') {
        if (u.pathname.includes('StatisticItemList')) return json({ StatisticItemList: { row: ['총지수', '음식료품', '섬유및가죽제품', '화학제품', '컴퓨터,전자및광학기기', '가구', '운송서비스'].map((n, i) => ({ ITEM_CODE: 'C' + i, ITEM_NAME: n, CYCLE: 'M' })) } });
        const code = u.pathname.split('/').pop(), ms = months(9).slice(0, 8);
        return json({ StatisticSearch: { row: ms.map((m, i) => ({ TIME: m.replace('-', ''), DATA_VALUE: String(118 + i * (code === 'C1' ? 0.6 : 0.2)) })) } });
    }
    if (u.hostname === 'kosis.kr' && u.searchParams.get('method') === 'getMeta') return json([
        { OBJ_ID: 'ITEM', OBJ_NM: '항목', OBJ_ID_SN: '0', ITM_ID: 'T1', ITM_NM: '근로자수' }, { OBJ_ID: 'ITEM', OBJ_NM: '항목', OBJ_ID_SN: '0', ITM_ID: 'T2', ITM_NM: '임금총액' },
        { OBJ_ID: 'A', OBJ_NM: '산업별', OBJ_ID_SN: '1', ITM_ID: '00', ITM_NM: '전산업' }, { OBJ_ID: 'A', OBJ_NM: '산업별', OBJ_ID_SN: '1', ITM_ID: 'C', ITM_NM: '제조업(10~34)' },
        { OBJ_ID: 'B', OBJ_NM: '규모별', OBJ_ID_SN: '2', ITM_ID: '0', ITM_NM: '전규모' }, { OBJ_ID: 'B', OBJ_NM: '규모별', OBJ_ID_SN: '2', ITM_ID: '1', ITM_NM: '5~299인' }]);
    if (u.hostname === 'kosis.kr') return json(months(12).slice(0, 10).map((m, i) => ({ PRD_DE: m.replace('-', ''), DT: String(4100000 + i * 12000), TBL_NM: '시험 임금표' })));
    if (u.hostname === 'openapi.foodsafetykorea.go.kr') {
        const q = decodeURIComponent(u.pathname.split('PRDLST_NM=')[1] || '');
        return json({ C005: { RESULT: { CODE: 'INFO-000' }, row: [{ BAR_CD: '880' + String(Math.round(rnd(q) * 1e9)), PRDLST_NM: q, BSSH_NM: '시험식품(주)', PRDLST_DCNM: '가공식품' }] } });
    }
    return json({ error: 'unknown host' }, 404);
};
