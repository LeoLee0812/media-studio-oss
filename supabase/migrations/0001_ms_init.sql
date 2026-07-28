-- media-studio 初始化 migration（在你的 Supabase 项目 SQL Editor 中执行）
-- 说明：4 张 ms_ 前缀表，RLS 全开，仅 ms_app 角色有策略；anon/publishable 默认全拒。
-- 另需先创建登录角色（一次性，不在本文件重复）：
--   create role ms_app login password '<DB_PASSWORD>';
--   grant usage on schema public to ms_app; grant ms_app to postgres;

create or replace function ms_touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create table if not exists ms_materials (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_id text,
  dedupe_key text unique,
  pillar text,
  title text,
  title_en text,
  url text,
  summary text,
  content text,
  category text,
  tags text[] default '{}',
  published_at timestamptz,
  status text not null default 'new',
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ms_materials_source_idx on ms_materials(source);
create index if not exists ms_materials_pillar_idx on ms_materials(pillar);
create index if not exists ms_materials_status_idx on ms_materials(status);
create index if not exists ms_materials_created_idx on ms_materials(created_at desc);

create table if not exists ms_topics (
  id uuid primary key default gen_random_uuid(),
  title text,
  angle text,
  pillar text,
  persona text,
  material_ids uuid[] default '{}',
  research jsonb,
  status text not null default 'idea',
  priority int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ms_topics_status_idx on ms_topics(status);
create index if not exists ms_topics_pillar_idx on ms_topics(pillar);

create table if not exists ms_drafts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references ms_topics(id) on delete cascade,
  platform text not null,
  title text,
  content text,
  meta jsonb,
  version int not null default 1,
  generator text,
  status text not null default 'draft',
  published_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ms_drafts_topic_idx on ms_drafts(topic_id);
create index if not exists ms_drafts_platform_idx on ms_drafts(platform);
create index if not exists ms_drafts_status_idx on ms_drafts(status);

create table if not exists ms_sync_state (
  key text primary key,
  value jsonb
);

drop trigger if exists ms_materials_touch on ms_materials;
create trigger ms_materials_touch before update on ms_materials for each row execute function ms_touch_updated_at();
drop trigger if exists ms_topics_touch on ms_topics;
create trigger ms_topics_touch before update on ms_topics for each row execute function ms_touch_updated_at();
drop trigger if exists ms_drafts_touch on ms_drafts;
create trigger ms_drafts_touch before update on ms_drafts for each row execute function ms_touch_updated_at();

alter table ms_materials enable row level security;
alter table ms_topics    enable row level security;
alter table ms_drafts    enable row level security;
alter table ms_sync_state enable row level security;

create policy ms_app_all on ms_materials to ms_app using (true) with check (true);
create policy ms_app_all on ms_topics to ms_app using (true) with check (true);
create policy ms_app_all on ms_drafts to ms_app using (true) with check (true);
create policy ms_app_all on ms_sync_state to ms_app using (true) with check (true);

grant select, insert, update, delete on ms_materials, ms_topics, ms_drafts, ms_sync_state to ms_app;
