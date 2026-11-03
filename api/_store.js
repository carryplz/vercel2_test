// 비플페이 응답 저장소 (Supabase Postgres, pooler 연결). DB를 바꿀 때는 이 파일만 교체하면 된다.
// 파일명이 _로 시작하면 Vercel이 API 경로로 노출하지 않는다.
import postgres from 'postgres';

// 서버리스 함수는 인스턴스마다 연결을 따로 열기 때문에 인스턴스당 1개만 쓴다.
// prepare: false 는 transaction pooler(6543)에서 필요하고 session pooler(5432)에서도 문제없다.
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  prepare: false,
  ssl: 'require',
});

// 모든 응답을 { 장소id: { v, t } } 형태로 돌려준다
export async function getAll() {
  const rows = await sql`select place_id, status, updated_at from public.biple_status`;
  const all = {};
  for (const r of rows) all[r.place_id] = { v: r.status, t: new Date(r.updated_at).getTime() };
  return all;
}

// 가장 최근 응답으로 덮어쓴다
export async function setStatus(id, vote) {
  const [r] = await sql`
    insert into public.biple_status (place_id, status, updated_at)
    values (${id}, ${vote}, now())
    on conflict (place_id) do update set status = excluded.status, updated_at = excluded.updated_at
    returning status, updated_at`;
  return { v: r.status, t: new Date(r.updated_at).getTime() };
}
