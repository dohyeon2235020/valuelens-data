// 유통 · API — 관세청 품목별 수출입실적 (공공데이터포털)
// HS 코드(4자리)별 월별 수입 단가(수입금액 ÷ 수입중량) → 지수(마지막 달 = 100)
// 필요한 Secret: DATA_GO_KR_KEY (공공데이터포털 '관세청_품목별 수출입실적(GW)'(15101609) 활용신청, 일반 인증키 Decoding)
import { mapping, fetchText, xmlItems, num, lastMonths, sleep, env } from './lib.mjs';

export const meta = { id: 'customs', name: '관세청 품목별 수입 단가', kind: 'distribution', type: 'api', provider: '관세청 · data.go.kr 15101609', file: 'data/distribution/api/customs.json',
    note: '수입 원료·부품·완제품의 kg당 수입 단가 변동률' };

export async function run() {
    const key = env('DATA_GO_KR_KEY');
    if (!key) return { status: 'skipped', message: 'DATA_GO_KR_KEY가 없어 건너뛰었어요.' };
    const hs = mapping().customs.hs;
    // 통계는 보통 한두 달 늦게 나와서 9개월을 받아 값이 있는 최근 7개월을 씀
    const months = lastMonths(9), start = months[0].replace('-', ''), end = months[months.length - 1].replace('-', '');
    const series = {}, errors = [];
    for (const [code, label] of Object.entries(hs)) {
        try {
            const u = `https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList?serviceKey=${encodeURIComponent(key)}&strtYymm=${start}&endYymm=${end}&hsSgn=${code}`;
            const xml = await fetchText(u);
            if (/<returnAuthMsg>|SERVICE_KEY_IS_NOT_REGISTERED|<resultCode>(?!00)/.test(xml) && !/<item>/.test(xml)) throw new Error((xml.match(/<(returnAuthMsg|resultMsg)>([^<]*)/) || [])[2] || 'API 오류');
            const sum = {};
            xmlItems(xml).forEach(it => {
                const ym = String(it.year || '').replace('.', '-'); if (!/^\d{4}-\d{2}$/.test(ym)) return;   // '총계' 행 제외
                const dlr = num(it.impDlr), wgt = num(it.impWgt); if (!dlr || !wgt) return;
                (sum[ym] = sum[ym] || { dlr: 0, wgt: 0 }); sum[ym].dlr += dlr; sum[ym].wgt += wgt;
            });
            const unit = months.map(m => sum[m] ? sum[m].dlr / sum[m].wgt : null);
            const last = unit.filter(v => v != null).pop();
            if (last) series[code] = { label: `HS ${code} ${label} 수입 단가 지수`, unit: 'index', usdPerKgLast: Math.round(last * 1000) / 1000, values: unit.map(v => v == null ? null : Math.round(v / last * 1000) / 10) };
        } catch (e) { errors.push(`${code}: ${e.message}`); if (errors.length >= 3 && !Object.keys(series).length) throw e; }
        await sleep(150);
    }
    // 뒤쪽에 비어 있는 달(아직 미발표)을 잘라 7개월로 맞춤
    let lastIdx = months.length - 1;
    while (lastIdx > 0 && !Object.values(series).some(s => s.values[lastIdx] != null)) lastIdx--;
    const from = Math.max(0, lastIdx - 6);
    Object.values(series).forEach(s => { s.values = s.values.slice(from, lastIdx + 1); });
    if (!Object.keys(series).length) throw new Error(errors[0] || '자료가 없어요.');
    return { status: 'ok', count: Object.keys(series).length, message: `HS 코드 ${Object.keys(series).length}개${errors.length ? ` · 오류 ${errors.length}건` : ''}`, data: { months: months.slice(from, lastIdx + 1), series } };
}
