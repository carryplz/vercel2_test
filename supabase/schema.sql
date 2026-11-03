-- Supabase 대시보드 > SQL Editor 에서 한 번 실행
create table if not exists public.biple_status (
  place_id   text primary key,               -- 카카오 장소 id
  status     text not null check (status in ('yes', 'no')),
  updated_at timestamptz not null default now()
);

-- 브라우저에서 직접 접근하지 못하게 막는다 (서버는 service_role 키로 접근)
alter table public.biple_status enable row level security;
