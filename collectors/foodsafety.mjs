// 유통 · API — 식품의약품안전처 바코드연계제품정보 (식품안전나라 C005)
// 실제 가격 식품 상품의 제조사·바코드·식품 유형 → 상품 맞추기 정확도 확인과 상세 화면 표시
// 필요한 Secret: FOODSAFETY_KEY (foodsafetykorea.go.kr 인증키 신청)
import { products, fetchJSON, similarity, sleep, env } from './lib.mjs';

export const meta = { id: 'foodsafety', name: '식약처 바코드 연계 제품정보', kind: 'distribution', type: 'api', provider: '식품의약품안전처 식품안전나라 (C005)', file: 'data/distribution/api/foodsafety-barcode.json',
    note: '제조사·바코드·식품 유형 (보조 정보, 원가 계산에는 쓰지 않음)' };

export async function run() {
    const key = env('FOODSAFETY_KEY');
    if (!key) return { status: 'skipped', message: 'FOODSAFETY_KEY가 없어 건너뛰었어요.' };
    const targets = products().filter(p => p.real && p.category === 'food');
    const out = {}, errors = [];
    for (const p of targets) {
        const q = p.name.replace(/\(.*?\)\s*$/, '').trim();
        try {
            const d = await fetchJSON(`http://openapi.foodsafetykorea.go.kr/api/${encodeURIComponent(key)}/C005/json/1/20/PRDLST_NM=${encodeURIComponent(q)}`);
            const res = d.C005 || {}, code = res.RESULT?.CODE;
            if (code && !['INFO-000', 'INFO-200'].includes(code)) throw new Error(`${code} ${res.RESULT?.MSG || ''}`);
            const rows = (res.row || []).map(r => ({ barcode: r.BAR_CD, name: r.PRDLST_NM, maker: r.BSSH_NM, type: r.PRDLST_DCNM, score: similarity(p.name, r.PRDLST_NM) }))
                .filter(r => r.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 3);
            if (rows.length) out[p.code] = { name: p.name, matches: rows };
        } catch (e) { errors.push(`${p.name}: ${e.message}`); if (errors.length >= 3 && !Object.keys(out).length) throw e; }
        await sleep(150);
    }
    return { status: 'ok', count: Object.keys(out).length, message: `식품 ${targets.length}개 중 ${Object.keys(out).length}개 확인${errors.length ? ` · 오류 ${errors.length}건` : ''}`, data: { products: out } };
}
