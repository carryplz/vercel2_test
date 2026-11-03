// 카카오 장소검색은 한 요청당 최대 45개(15개 x 3페이지)까지만 주기 때문에
// 구획 영역을 사각형으로 잘게 나눠 여러 번 검색한다.
const MAX_REQUESTS = 300;
const MAX_DEPTH = 5;
const REFRESH_MS = 30_000;
// 음식점 분류 중에서도 빼고 싶은 업종이 생기면 여기에 추가 (예: '음식점 > 술집')
const EXCLUDE_CATEGORIES = [];

const $ = (id) => document.getElementById(id);
const state = {
  map: null,
  places: null,
  geocoder: null,
  overlays: new Map(), // place id -> { overlay, el, place }
  polygons: [],
  statuses: {}, // place id -> { v: 'yes' | 'no', t }
  boundaryCache: new Map(), // 시군구 코드 -> 행정동 목록
  selectedId: null,
};

init();

async function init() {
  try {
    const { kakaoKey } = await (await fetch('/api/config')).json();
    if (!kakaoKey) throw new Error('KAKAO_JS_KEY 환경변수가 설정되지 않았습니다.');
    await loadKakao(kakaoKey);
  } catch (err) {
    showStatus(`지도를 불러오지 못했습니다: ${err.message}`, true);
    return;
  }

  state.map = new kakao.maps.Map($('map'), {
    center: new kakao.maps.LatLng(37.5665, 126.978),
    level: 5,
  });
  state.places = new kakao.maps.services.Places();
  state.geocoder = new kakao.maps.services.Geocoder();

  $('search-form').addEventListener('submit', onSearch);
  $('highlight-toggle').addEventListener('click', toggleHighlight);
  $('panel-close').addEventListener('click', closePanel);
  $('vote-yes').addEventListener('click', () => vote('yes'));
  $('vote-no').addEventListener('click', () => vote('no'));

  await loadStatuses();
  // 다른 사용자의 응답도 곧바로 지도에 반영되도록 주기적으로 갱신
  setInterval(loadStatuses, REFRESH_MS);
}

function loadKakao(key) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    s.onload = () => kakao.maps.load(resolve);
    s.onerror = () => reject(new Error('카카오맵 SDK 로드 실패 (도메인 등록을 확인하세요)'));
    document.head.appendChild(s);
  });
}

// ---------- 검색: 동 이름 또는 지명 ----------

async function onSearch(e) {
  e.preventDefault();
  const input = $('region-input').value.trim();
  if (!input) return;
  $('region-choices').hidden = true;

  const { region: q, keyword } = await parseQuery(input);
  if (!q) {
    showStatus('어느 동이나 지명에서 찾을지 함께 입력해 주세요. (예: 역삼동 쌀국수)', true);
    return;
  }
  showStatus(`"${q}" 위치를 찾는 중…${keyword ? ` (찾는 음식: ${keyword})` : ''}`);

  let candidates = await findRegions(q);
  if (!candidates.length) candidates = await findLandmarks(q);
  if (!candidates.length) {
    showStatus(`"${q}"에 해당하는 동이나 지명을 찾지 못했습니다.`, true);
    return;
  }
  if (candidates.length === 1) return collect(candidates[0], keyword);
  showChoices(candidates, keyword);
}

// 한 단어("역삼동")는 그대로 쓰고, 문장("역삼동 쌀국수집 검색해줘")은 Gemini로 지역/음식을 나눈다
async function parseQuery(input) {
  if (!/\s/.test(input)) return { region: input, keyword: '' };
  showStatus('검색어를 해석하는 중…');
  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: input }),
    });
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return { region: input, keyword: '' };
  }
}

function findRegions(q) {
  return new Promise((resolve) => {
    state.geocoder.addressSearch(q, (results, status) => {
      if (status !== kakao.maps.services.Status.OK) return resolve([]);
      const regions = results.filter((r) => r.address_type === 'REGION');
      if (regions.length) {
        return resolve(regions.map((r) => ({
          kind: 'region',
          label: r.address_name,
          x: Number(r.x),
          y: Number(r.y),
          address: r.address,
          query: q,
        })));
      }
      // "동성로" 같은 도로명: 그 도로가 지나는 동을 기준으로 한다
      const roads = results.filter((r) => r.address_type === 'ROAD' || r.address_type === 'ROAD_ADDR');
      resolve(uniqueBy(roads.map((r) => ({
        kind: 'landmark',
        label: r.address_name,
        x: Number(r.x),
        y: Number(r.y),
      })), (c) => c.label));
    });
  });
}

function findLandmarks(q) {
  return new Promise((resolve) => {
    state.places.keywordSearch(q, (data, status) => {
      if (status !== kakao.maps.services.Status.OK) return resolve([]);
      // 같은 동에 있는 장소는 하나만 남겨서, 후보 목록에 서로 다른 지역만 보이게 한다
      const byDong = uniqueBy(data, (p) => p.address_name.split(' ').slice(0, 3).join(' '));
      resolve(byDong.slice(0, 8).map((p) => ({
        kind: 'landmark',
        label: `${p.place_name} · ${p.address_name.split(' ').slice(0, 3).join(' ')}`,
        x: Number(p.x),
        y: Number(p.y),
      })));
    });
  });
}

function uniqueBy(list, keyOf) {
  const seen = new Set();
  return list.filter((item) => {
    const k = keyOf(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function showChoices(list, keyword) {
  const ul = $('region-choices');
  ul.replaceChildren(...list.map((c) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = c.label;
    btn.onclick = () => { ul.hidden = true; collect(c, keyword); };
    li.appendChild(btn);
    return li;
  }));
  ul.hidden = false;
  showStatus('검색 결과가 여러 개입니다. 하나를 선택하세요.');
}

// ---------- 행정동 경계 ----------

function regionCodeAt(x, y) {
  return new Promise((resolve) => {
    state.geocoder.coord2RegionCode(x, y, (result, status) => {
      if (status !== kakao.maps.services.Status.OK) return resolve(null);
      resolve(result.find((r) => r.region_type === 'H') || null);
    });
  });
}

async function loadBoundaries(sgg) {
  if (!state.boundaryCache.has(sgg)) {
    const res = await fetch(`/boundaries/${sgg}.json`);
    state.boundaryCache.set(sgg, res.ok ? await res.json() : []);
  }
  return state.boundaryCache.get(sgg);
}

// "역삼1동" -> "역삼", "성수1가2동"·"성수동1가" -> "성수1가", "일원본동" -> "일원"
const dongBase = (name) => name.replace(/동(\d+가)$/, '$1').replace(/(\d+|본)?동$/, '');

// 검색 결과 하나를 지도에 그릴 행정동 목록으로 바꾼다
async function resolveDongs(c) {
  const h = await regionCodeAt(c.x, c.y);
  if (!h) return null;
  const dongs = await loadBoundaries(h.code.slice(0, 5));
  const here = dongs.filter((d) => d.code === h.code);
  if (c.kind === 'landmark') return { label: h.address_name, dongs: here };

  const a = c.address || {};
  if (!a.region_3depth_name && !a.region_3depth_h_name) {
    // 구 단위 검색: 구 전체
    return a.region_2depth_name ? { label: c.label, dongs } : null;
  }
  // 행정동으로 검색한 경우 (예: 역삼1동)
  if (a.region_3depth_h_name && c.query.endsWith(a.region_3depth_h_name)) {
    return { label: c.label, dongs: here };
  }
  // 법정동으로 검색한 경우 (예: 역삼동 = 역삼1동 + 역삼2동)
  const base = dongBase(a.region_3depth_name || a.region_3depth_h_name);
  const siblings = dongs.filter((d) => dongBase(d.name) === base);
  return { label: c.label, dongs: siblings.length ? siblings : here };
}

function drawBoundaries(dongs) {
  state.polygons.forEach((p) => p.setMap(null));
  state.polygons = [];
  for (const d of dongs) {
    for (const rings of d.polygons) {
      const polygon = new kakao.maps.Polygon({
        map: state.map,
        path: rings.map((ring) => ring.map(([x, y]) => new kakao.maps.LatLng(y, x))),
        strokeWeight: 2,
        strokeColor: '#2f6df6',
        strokeOpacity: 0.9,
        fillColor: '#2f6df6',
        fillOpacity: 0.06,
      });
      state.polygons.push(polygon);
    }
  }
}

function boundsOf(dongs) {
  const box = { sw: [Infinity, Infinity], ne: [-Infinity, -Infinity] };
  for (const d of dongs) {
    for (const [x, y] of d.polygons.flatMap((rings) => rings[0])) {
      box.sw = [Math.min(box.sw[0], y), Math.min(box.sw[1], x)];
      box.ne = [Math.max(box.ne[0], y), Math.max(box.ne[1], x)];
    }
  }
  return box;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inDongs(place, dongs) {
  const x = Number(place.x);
  const y = Number(place.y);
  return dongs.some((d) => d.polygons.some(([outer, ...holes]) =>
    pointInRing(x, y, outer) && !holes.some((h) => pointInRing(x, y, h))));
}

// ---------- 식당 수집 ----------

function isRestaurant(place) {
  const cat = place.category_name || '';
  return cat.startsWith('음식점') && !EXCLUDE_CATEGORIES.some((ex) => cat.startsWith(ex));
}

async function collect(candidate, keyword = '') {
  clearOverlays();
  closePanel();

  const area = await resolveDongs(candidate);
  if (!area || !area.dongs.length) {
    showStatus('구역 경계를 찾지 못했습니다. 동 또는 구 이름으로 검색해 주세요.', true);
    return;
  }
  drawBoundaries(area.dongs);

  const box = boundsOf(area.dongs);
  state.map.setBounds(new kakao.maps.LatLngBounds(
    new kakao.maps.LatLng(box.sw[0], box.sw[1]),
    new kakao.maps.LatLng(box.ne[0], box.ne[1]),
  ));

  const names = area.dongs.map((d) => d.name).join(', ');
  const label = (area.dongs.length > 4 ? area.label : `${area.label} (${names})`)
    + (keyword ? ` · "${keyword}"` : '');
  const found = new Map();
  const ctx = { requests: 0, truncated: false, keyword };
  showStatus(`${label} 식당 정보를 수집하는 중…`);
  await searchRect(box, 0, found, ctx, label);

  const inside = [...found.values()].filter((p) => isRestaurant(p) && inDongs(p, area.dongs));
  if (!inside.length) {
    showStatus(`${label} 안에서 식당을 찾지 못했습니다.`, true);
    return;
  }
  inside.forEach(addOverlay);

  const yesCount = inside.filter((p) => verdict(p.id) === 'yes').length;
  showStatus(
    `${label}: 식당 ${inside.length}곳 · 비플페이 가능 ${yesCount}곳`
    + (ctx.truncated ? ' (검색량 제한으로 일부 누락됐을 수 있음)' : ''),
  );
}

async function searchRect(box, depth, found, ctx, label) {
  if (ctx.requests >= MAX_REQUESTS) { ctx.truncated = true; return; }
  const first = await categoryPage(box, 1, ctx);
  first.data.forEach((p) => found.set(p.id, p));
  showStatus(`${label} 식당 정보를 수집하는 중… ${found.size}곳`);

  const total = first.pagination ? first.pagination.totalCount : 0;
  if (total > 45 && depth < MAX_DEPTH) {
    for (const sub of splitBox(box)) await searchRect(sub, depth + 1, found, ctx, label);
    return;
  }
  if (total > 45) ctx.truncated = true;
  const last = first.pagination ? first.pagination.last : 1;
  for (let page = 2; page <= last; page++) {
    if (ctx.requests >= MAX_REQUESTS) { ctx.truncated = true; return; }
    const r = await categoryPage(box, page, ctx);
    r.data.forEach((p) => found.set(p.id, p));
  }
}

function categoryPage(box, page, ctx) {
  ctx.requests++;
  const bounds = new kakao.maps.LatLngBounds(
    new kakao.maps.LatLng(box.sw[0], box.sw[1]),
    new kakao.maps.LatLng(box.ne[0], box.ne[1]),
  );
  return new Promise((resolve) => {
    const done = (data, status, pagination) => {
      if (status === kakao.maps.services.Status.OK) resolve({ data, pagination });
      else resolve({ data: [], pagination: null });
    };
    // FD6 = 음식점. 음식 키워드가 있으면 음식점 중 키워드에 맞는 곳만 검색
    if (ctx.keyword) {
      state.places.keywordSearch(ctx.keyword, done, { bounds, page, category_group_code: 'FD6' });
    } else {
      state.places.categorySearch('FD6', done, { bounds, page });
    }
  });
}

function splitBox({ sw, ne }) {
  const midLat = (sw[0] + ne[0]) / 2;
  const midLng = (sw[1] + ne[1]) / 2;
  return [
    { sw: [sw[0], sw[1]], ne: [midLat, midLng] },
    { sw: [sw[0], midLng], ne: [midLat, ne[1]] },
    { sw: [midLat, sw[1]], ne: [ne[0], midLng] },
    { sw: [midLat, midLng], ne: [ne[0], ne[1]] },
  ];
}

// ---------- 마커 ----------

function addOverlay(place) {
  const el = document.createElement('div');
  el.className = 'pin';
  el.title = place.place_name;
  el.addEventListener('click', () => openPanel(place.id));
  const overlay = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(place.y, place.x),
    content: el,
    yAnchor: 0.5,
    xAnchor: 0.5,
  });
  overlay.setMap(state.map);
  state.overlays.set(place.id, { overlay, el, place });
  paintPin(place.id);
}

function clearOverlays() {
  state.overlays.forEach(({ overlay }) => overlay.setMap(null));
  state.overlays.clear();
}

function paintPin(id) {
  const item = state.overlays.get(id);
  if (!item) return;
  const v = verdict(id);
  item.el.classList.toggle('yes', v === 'yes');
  item.el.classList.toggle('no', v === 'no');
  item.el.classList.toggle('selected', id === state.selectedId);
  // 형광 마커가 다른 마커에 가리지 않도록
  item.overlay.setZIndex(id === state.selectedId ? 4 : v === 'yes' ? 3 : 1);
}

function toggleHighlight() {
  const on = document.body.classList.toggle('highlight');
  $('highlight-toggle').setAttribute('aria-pressed', String(on));
}

// ---------- 공유 상태 (가장 최근 응답 우선) ----------

async function loadStatuses() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error();
    state.statuses = await res.json();
    state.overlays.forEach((_, id) => paintPin(id));
    if (state.selectedId) renderVote(state.selectedId);
  } catch {
    showStatus('공유 데이터를 불러오지 못했습니다. (저장소 연결을 확인하세요)', true);
  }
}

function verdict(id) {
  const s = state.statuses[id];
  return s ? s.v : 'unknown';
}

async function vote(v) {
  const id = state.selectedId;
  if (!id) return;
  setVoteDisabled(true);
  try {
    const res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, vote: v }),
    });
    if (!res.ok) throw new Error();
    state.statuses[id] = await res.json();
    paintPin(id);
    renderVote(id);
  } catch {
    alert('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    setVoteDisabled(false);
  }
}

function setVoteDisabled(d) {
  $('vote-yes').disabled = d;
  $('vote-no').disabled = d;
}

// ---------- 패널 ----------

function openPanel(id) {
  const item = state.overlays.get(id);
  if (!item) return;
  const prevId = state.selectedId;
  state.selectedId = id;
  if (prevId) paintPin(prevId);
  paintPin(id);

  const p = item.place;
  $('p-name').textContent = p.place_name;
  $('p-category').textContent = p.category_name.replace(/^음식점 > /, '');
  $('p-address').textContent = p.road_address_name || p.address_name;
  $('p-phone').textContent = p.phone || '';
  $('p-link').href = p.place_url;
  renderVote(id);
  $('panel').hidden = false;
}

function closePanel() {
  const prevId = state.selectedId;
  state.selectedId = null;
  if (prevId) paintPin(prevId);
  $('panel').hidden = true;
}

function renderVote(id) {
  const s = state.statuses[id];
  $('vote-yes').classList.toggle('mine', s?.v === 'yes');
  $('vote-no').classList.toggle('mine', s?.v === 'no');
  $('p-verdict').textContent = !s ? '아직 아무도 응답하지 않았어요. 첫 번째로 알려주세요!'
    : s.v === 'yes' ? '✅ 비플페이 사용 가능 식당'
    : '❌ 비플페이 사용 불가 식당';
  $('p-updated').textContent = s ? `마지막 응답: ${formatTime(s.t)}` : '';
}

function formatTime(t) {
  const d = new Date(t);
  const diff = Math.floor((Date.now() - t) / 1000);
  const rel = diff < 60 ? '방금 전'
    : diff < 3600 ? `${Math.floor(diff / 60)}분 전`
    : diff < 86400 ? `${Math.floor(diff / 3600)}시간 전`
    : `${Math.floor(diff / 86400)}일 전`;
  const abs = d.toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `${abs} (${rel})`;
}

function showStatus(msg, isError = false) {
  const bar = $('status-bar');
  bar.textContent = msg;
  bar.classList.toggle('error', isError);
  bar.hidden = false;
}
