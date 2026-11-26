# valuelens-data

ValueLens(밸류렌즈)가 읽는 **유통·커머스 데이터 수집 저장소**예요. GitHub Actions가 매일 API를 불러 결과를 `data/`에 저장하고, GitHub Pages로 공개해요. ValueLens는 서버 없이 이 파일을 읽어요.

- API 키는 저장소 **Secrets**에만 있어요. 사이트와 데이터 파일에는 들어가지 않아요.
- 한 API가 실패해도 이전에 모은 파일은 그대로 두고 다음 API를 계속 모아요.

## 데이터 분류

| 폴더 | 분류 | 파일 | 출처 |
|---|---|---|---|
| `data/distribution/db/` | 유통 · DB | `chamgagyeok-cost.json` | 참가격 가격으로 역산한 추정 원가 (고정) |
| `data/distribution/api/` | 유통 · API | `kamis.json` | KAMIS 농축수산물 소매가격 지수 (공공데이터포털 '일별 도,소매 가격정보') |
| | | `customs.json` | 관세청 HS 코드별 수입 단가 지수 |
| | | `ecos.json` | 한국은행 생산자물가지수 (카테고리별 · 운송) |
| | | `kosis.json` | 통계청 월평균 임금 지수 |
| `data/commerce/db/` | 커머스 · DB | `chamgagyeok-csv.json` | 한국소비자원 참가격 CSV 요약 (고정) |
| `data/commerce/api/` | 커머스 · API | `chamgagyeok.json` | 한국소비자원 참가격 전체 (매달 자료 API · 상품 × 판매처 체인 가격 · 최근 7개 자료 추이) |
| | | `commons-images.json` | 위키미디어 커먼스 품목별 사진 (저작자·라이선스 포함) |
| `data/` | 목록 | `manifest.json` | 소스 목록·분류·상태·수집일 |
| `data/distribution/db/` | 유통 · DB | (수집 때 생성) | 실제 가격 상품 60개의 원가 변동 지표 후보 `../cost-drivers.json` |

## 처음 설정 (한 번만)

1. **저장소 만들기**: 이 폴더 내용을 공개(Public) 저장소 `valuelens-data`에 올려요.
2. **키 발급** (각 사이트에서 직접):

   | Secret 이름 | 어디서 |
   |---|---|
   | `DATA_GO_KR_KEY` | data.go.kr → '관세청_품목별 수출입실적(GW)'(15101609)과 '한국농수산식품유통공사_일별 도,소매 가격정보 조회' 활용신청 → 일반 인증키(Decoding). 키 하나로 관세청과 KAMIS를 모두 받아요 |
   | `ECOS_KEY` | ecos.bok.or.kr → Open API → 인증키 신청 |
   | `KOSIS_KEY` | kosis.kr/openapi → 인증키 신청 |

3. **Secrets 넣기**: 저장소 Settings → Secrets and variables → Actions → New repository secret. 키가 없는 API는 건너뛰어요.
4. **KOSIS 통계표**: 기본으로 고용노동부 사업체노동력조사 '산업/규모별 임금 및 근로시간'(118 / DT_118N_MON054)에서 **제조업 · 전규모 임금총액**을 자동으로 골라요. 다른 표를 쓰려면 Settings → Secrets and variables → Actions → **Variables** 탭 → `KOSIS_PARAMS`에 JSON을 넣어요.
5. **Pages 켜기**: Settings → Pages → Source 'Deploy from a branch' → `main` / `(root)` → Save. 주소: `https://아이디.github.io/valuelens-data`
6. **첫 수집**: Actions 탭 → '데이터 수집' → Run workflow. 이후 매일 04:17(한국 시간)에 자동으로 실행돼요.
7. **ValueLens 연결**: ValueLens → DB 관리 → 'GitHub 수집 데이터'에 Pages 주소를 넣고 '연결'.

## ValueLens에서 쓰는 방식

- **커머스**: 한국소비자원 참가격 API로 전체 상품(약 600개)의 판매처 체인별 가격과 월별 추이를 모아요. 품목 분류와 사진 검색어는 `config/chamgagyeok-items.json`에서 바꿔요(사진을 고정하려면 `file`에 커먼스 파일 이름). 예전 CSV 60개는 API를 끄거나 못 받을 때 쓰는 기본값이에요. 네이버 쇼핑 검색 API는 NAVER API HUB로 옮겨지면서 쇼핑 상품 검색이 제공되지 않아 뺐어요.
- **유통**: 원가 금액은 그대로 두고, 원재료비·공임·포장물류비마다 `cost-drivers.json`의 후보 지표(앞에서부터 켜져 있고 값이 있는 것)의 실제 변동률로 최근 7개월 원가 추이를 다시 그려요. 원가 반영 판정(판매가가 원가보다 더 올랐나)이 이 추이를 써요.
- **기존 유통 항목과의 관계**: 실제 데이터는 ValueLens에 원래 있던 유통 항목에 붙어요. KAMIS → 'aT KAMIS 농수산물 시세', 관세청 → 'HS 코드별 수입 통관 단가'(+ '임산물·목재 시세'의 대체 출처), 한국은행 생산자물가 → 각 원재료비 항목의 대체 출처와 '공공 원가 DB'의 포장·물류비, 통계청 임금 → '직업별 표준 노임 단가'의 대체 출처. 항목마다 실제 데이터를 켜고 끌 수 있고, 끄면 고정값을 써요.
- 연결 규칙은 `config/mapping.json`에서 바꿔요 (키워드 → KAMIS 품목·HS 코드·생산자물가 그룹). ValueLens는 이 파일을 직접 읽어 가상 상품까지 모든 상품의 지표를 정해요.
- `config/products.json`은 수집 대상(실제 가격 상품 60개) 목록이에요.

## 로컬에서 시험

```
node collect.mjs                    # 키 없이: 전부 건너뜀
node --import ./test/mock-fetch.mjs collect.mjs   # 가짜 응답으로 전체 흐름 시험 (결과를 커밋하지 마세요)
```

## 이용 조건 메모

- 공공데이터(참가격·관세청·KAMIS 등)는 각 기관의 이용 조건을 따라요.
