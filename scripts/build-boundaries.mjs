// 행정동 경계 GeoJSON(github.com/vuski/admdongkor)을 시군구별 작은 파일로 나눈다.
// 사용법: node scripts/build-boundaries.mjs <HangJeongDong_verYYYYMMDD.geojson>
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-boundaries.mjs <geojson>');
  process.exit(1);
}

const OUT = new URL('../public/boundaries/', import.meta.url);
const round = (n) => Math.round(n * 1e5) / 1e5; // 약 1m 정밀도

function simplifyRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [round(x), round(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

const { features } = JSON.parse(readFileSync(src, 'utf8'));
const bySgg = new Map();
for (const f of features) {
  const { adm_cd2, adm_nm, sgg } = f.properties;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const dong = {
    code: adm_cd2,
    name: adm_nm.split(' ').pop(),
    full: adm_nm,
    polygons: polys.map((poly) => poly.map(simplifyRing)),
  };
  if (!bySgg.has(sgg)) bySgg.set(sgg, []);
  bySgg.get(sgg).push(dong);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [sgg, dongs] of bySgg) {
  writeFileSync(new URL(`${sgg}.json`, OUT), JSON.stringify(dongs));
}
console.log(`${features.length} dongs -> ${bySgg.size} files`);
