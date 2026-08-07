-- media-studio 建表脚本（Cloudflare D1 / SQLite）
--
-- 用法：npx wrangler d1 execute <你的库名> --remote --file=db/0001_init.sql
--
-- 与原来的 Postgres 版相比有三处结构性差异，改查询时留意：
--   ① 没有原生数组与 jsonb —— tags / material_ids / raw / research / meta / value
--      全部是 TEXT，里面存 JSON，读的时候用 json_extract / json_each。
--   ② 时间统一存 ISO-8601 字符串（2026-08-07T05:19:42.858Z），比较就是字符串比大小。
--      别用 SQLite 的 datetime('now')，它给的是 "YYYY-MM-DD HH:MM:SS"，跟这个格式对不上。
--   ③ 没有角色与 RLS —— D1 数据库整体挂在你自己的 Worker 绑定上，外部拿不到，
--      访问控制由 middleware 的密码门 + READ_ONLY 承担。

-- SQLite 没有内建 uuid()，用 randomblob 拼一个标准 v4，保持与旧数据同形
create table if not exists ms_materials (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
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
  tags text not null default '[]',          -- JSON 数组
  published_at text,
  status text not null default 'new',
  raw text,                                  -- JSON 对象
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists ms_materials_source_idx  on ms_materials(source);
create index if not exists ms_materials_pillar_idx  on ms_materials(pillar);
create index if not exists ms_materials_status_idx  on ms_materials(status);
create index if not exists ms_materials_created_idx on ms_materials(created_at desc);

create table if not exists ms_topics (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  title text,
  angle text,
  pillar text,
  persona text,
  material_ids text not null default '[]',   -- JSON 数组，存素材 id
  research text,                             -- JSON 对象
  status text not null default 'idea',
  priority integer not null default 0,
  notes text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists ms_topics_status_idx on ms_topics(status);
create index if not exists ms_topics_pillar_idx on ms_topics(pillar);

create table if not exists ms_drafts (
  id text primary key default (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
    lower(hex(randomblob(6)))
  ),
  topic_id text references ms_topics(id) on delete cascade,
  platform text not null,
  title text,
  content text,
  meta text,                                 -- JSON 对象
  version integer not null default 1,
  generator text,
  status text not null default 'draft',
  published_url text,
  published_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index if not exists ms_drafts_topic_idx    on ms_drafts(topic_id);
create index if not exists ms_drafts_platform_idx on ms_drafts(platform);
create index if not exists ms_drafts_status_idx   on ms_drafts(status);

-- 全站唯一的键值表：采集状态、配置单例、提示词覆盖、稿件级缓存都在这儿
-- （已占用的 key 空间见 lib/queries.ts 里 getSyncState 上方的清单）
create table if not exists ms_sync_state (
  key text primary key,
  value text                                 -- JSON
);

-- updated_at 自动跟随（Postgres 版是触发器函数，SQLite 直接写三个触发器）
create trigger if not exists ms_materials_touch after update on ms_materials
-- when 守卫：触发器自己那次 update 会改掉 updated_at，条件不再成立，避免递归
when old.updated_at = new.updated_at
begin
  update ms_materials set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;

create trigger if not exists ms_topics_touch after update on ms_topics
-- when 守卫：触发器自己那次 update 会改掉 updated_at，条件不再成立，避免递归
when old.updated_at = new.updated_at
begin
  update ms_topics set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;

create trigger if not exists ms_drafts_touch after update on ms_drafts
-- when 守卫：触发器自己那次 update 会改掉 updated_at，条件不再成立，避免递归
when old.updated_at = new.updated_at
begin
  update ms_drafts set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = new.id;
end;
