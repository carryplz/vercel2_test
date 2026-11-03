# 비플페이 식당 지도

동 이름(예: `역삼동`, `역삼1동`), 구 이름, 지명(예: `강남역`)을 입력하면 해당 행정동 경계를 지도에 그리고,
경계 안의 식당을 카카오맵에서 수집해 표시합니다. 지명은 그 지명이 속한 행정동을 기준으로 합니다.

식당을 클릭해 **비플페이 가능 / 불가능**을 표시할 수 있고, 결과는 모든 사용자에게 공유됩니다.
여러 사람이 응답하면 **가장 최근 응답**이 적용되며, 마지막 응답 시각이 함께 표시됩니다.
가능한 식당은 기본으로 **형광색**으로 빛나고, 상단 버튼으로 끌 수 있습니다.
영업시간은 카카오 API가 제공하지 않아 식당 정보창의 카카오맵 상세 링크로 확인합니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `public/` | 화면 (지도, 검색, 식당 패널, 형광 필터) |
| `api/config.js` | 카카오 JavaScript 키를 환경변수에서 전달 |
| `api/status.js` | 가능/불가능 응답 저장·조회 API (최신 응답 우선) |
| `api/_store.js` | 저장소 연결 (Supabase Postgres, pooler). DB를 바꿀 때는 이 파일만 교체 |
| `supabase/schema.sql` | Supabase 테이블 생성 SQL |
| `public/boundaries/` | 시군구별 행정동 경계 (`scripts/build-boundaries.mjs`로 생성) |

## 행정동 경계 데이터 갱신

경계는 [vuski/admdongkor](https://github.com/vuski/admdongkor)의 행정동 GeoJSON(현재 `ver20261001`)을 사용합니다.
행정동이 바뀌면 최신 파일을 받아 다시 생성하세요.

```bash
node scripts/build-boundaries.mjs HangJeongDong_verYYYYMMDD.geojson
```

## 배포 방법 (Vercel)

1. **카카오 키 발급**: [developers.kakao.com](https://developers.kakao.com) → 내 애플리케이션 → 앱 추가
   - 앱 키 → **JavaScript 키** 복사
   - 앱 설정 → 플랫폼 → Web → 사이트 도메인에 `https://<프로젝트>.vercel.app` 과 `http://localhost:3000` 등록
   - 제품 설정 → 카카오맵 → 활성화
2. **Vercel에 프로젝트 import** (이 GitHub 저장소 선택, Framework: Other)
3. **Supabase 준비**: [supabase.com](https://supabase.com)에서 프로젝트 생성 → SQL Editor에서 `supabase/schema.sql` 실행
   → 상단 **Connect** → Connection String에서 **Transaction pooler**(포트 6543, 권장) 또는 Session pooler(5432) 주소 복사
   → 주소의 `[YOUR-PASSWORD]`를 DB 비밀번호로 교체
4. **환경변수 추가**: Settings → Environment Variables → `KAKAO_JS_KEY` = 1번의 JavaScript 키
   - `DATABASE_URL` = 3번의 pooler 주소
   - `GEMINI_API_KEY` = [Google AI Studio](https://aistudio.google.com/apikey)에서 발급한 키 ("역삼동 쌀국수집 찾아줘" 같은 문장 검색용)
   - (선택) `GEMINI_MODEL` = 사용할 모델 이름, 기본값 `gemini-3.5-flash-lite`
5. 재배포

## 로컬 실행

```bash
npm install
npx vercel link        # Vercel 프로젝트와 연결
npx vercel env pull    # 환경변수 내려받기
npx vercel dev         # http://localhost:3000
```
