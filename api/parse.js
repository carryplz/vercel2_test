// 자연어 검색어("역삼동 쌀국수집 검색해줘")를 Gemini로 { region, keyword } 로 나눈다.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_LEN = 100;

const PROMPT = `너는 한국 식당 지도 검색창의 입력을 해석한다.
입력에서 두 가지를 뽑아 JSON으로만 답하라.
- region: 동/구 이름 또는 지명 (예: "역삼동", "강남구", "강남역"). 입력에 시/도/구 이름(서울, 대구, 해운대구 등)이 있으면 지우지 말고 앞에 붙여라. 없으면 빈 문자열.
- keyword: 찾는 음식 종류나 식당 종류를 카카오맵 검색어로 쓸 짧은 단어 (예: "쌀국수", "돈까스", "중식"). "집", "맛집", "식당" 같은 말은 빼라. 없으면 빈 문자열.
예) "역삼동 쌀국수집 검색해줘" -> {"region":"역삼동","keyword":"쌀국수"}
예) "강남역 근처 맛있는 초밥" -> {"region":"강남역","keyword":"초밥"}
예) "대구 동성로 쪽 쌀국수 집 찾아줘" -> {"region":"대구 동성로","keyword":"쌀국수"}
예) "부산 해운대구 우동 돼지국밥" -> {"region":"부산 해운대구 우동","keyword":"돼지국밥"}
예) "성수동" -> {"region":"성수동","keyword":""}
입력: `;

const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원',
  '충북', '충남', '충청북도', '충청남도', '전북', '전남', '전라북도', '전라남도',
  '경북', '경남', '경상북도', '경상남도', '제주'];

// Gemini가 "대구 동성로"에서 "대구"를 빼먹으면 같은 이름의 다른 지역(부산 등)이 잡히므로 다시 붙인다
function keepSido(input, region) {
  if (!region) return region;
  const sido = SIDO.find((s) => input.includes(s));
  if (!sido || region.includes(sido)) return region;
  return `${sido} ${region}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'GEMINI_API_KEY not set' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  const q = String(body.q || '').trim().slice(0, MAX_LEN);
  if (!q) return res.status(400).json({ error: 'empty query' });

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT + JSON.stringify(q) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { region: { type: 'STRING' }, keyword: { type: 'STRING' } },
            required: ['region', 'keyword'],
          },
        },
      }),
    });
    if (!r.ok) {
      console.error('gemini', r.status, await r.text());
      return res.status(502).json({ error: 'gemini error' });
    }
    const data = await r.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = JSON.parse(text);
    return res.status(200).json({
      region: keepSido(q, String(parsed.region || '').trim()).slice(0, 40),
      keyword: String(parsed.keyword || '').trim().slice(0, 20),
    });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'parse failed' });
  }
}
