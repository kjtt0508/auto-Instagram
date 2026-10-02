-- ジョブ・稼働記録・公開の記録（docs/design/01_DB設計.md 2.4, 2.5）

create table jobs (                     -- 予定表。状態・ロックは UPDATE する（ADR-0006）
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  job_type      text not null check (job_type in
                  ('PREPARE_MEDIA','PUBLISH_POST','REFRESH_TOKEN','COLLECT_INSIGHTS','COLLECT_NEWS','GENERATE_DRAFTS')),
  post_id       uuid references posts(id),            -- nullable: 投稿に関係しないジョブ
  dedupe_key    text not null unique,
  run_at        timestamptz not null,
  status        text not null check (status in ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  attempts      int  not null default 0 check (attempts >= 0),
  max_attempts  int  not null check (max_attempts >= 1),
  locked_until  timestamptz,                          -- nullable: 実行中以外はロックを持たない
  created_at    timestamptz not null default now(),
  check (attempts <= max_attempts),
  check ((status = 'RUNNING') = (locked_until is not null)),
  check ((job_type in ('PREPARE_MEDIA','PUBLISH_POST')) = (post_id is not null))
);
create index jobs_pending_idx on jobs (status, run_at);

create table job_attempts (
  id            bigint generated always as identity primary key,
  job_id        uuid not null references jobs(id),
  attempt_no    int  not null check (attempt_no >= 1),
  runner        text not null,
  started_at    timestamptz not null default now(),
  unique (job_id, attempt_no)
);

create table job_attempt_results (
  job_attempt_id  bigint primary key references job_attempts(id),
  outcome         text not null check (outcome in ('SUCCEEDED','FAILED','RETRY')),
  error_kind      text,                                -- nullable: 成功時
  error_detail    text check (char_length(error_detail) <= 2000),   -- nullable: 成功時
  in_job_retries  int  not null default 0 check (in_job_retries >= 0),
  finished_at     timestamptz not null default now()
);

create table batch_heartbeats (
  id         bigint generated always as identity primary key,
  workflow   text not null check (workflow in ('tick','daily','weekly')),
  run_id     text not null,
  phase      text not null check (phase in ('STARTED','FINISHED')),
  at         timestamptz not null default now(),
  unique (workflow, run_id, phase)
);

create table publish_media (            -- Instagram に渡す公開用 JPEG
  id            uuid primary key default gen_random_uuid(),
  revision_id   uuid not null references post_revisions(id),
  position      int  not null check (position >= 1),
  storage_path  text not null unique,
  width         int  not null check (width > 0),
  height        int  not null check (height > 0),
  byte_size     int  not null check (byte_size > 0),
  prepared_at   timestamptz not null default now(),
  unique (revision_id, position)
);

create table ig_containers (
  id              bigint generated always as identity primary key,
  post_id         uuid not null references posts(id),
  job_attempt_id  bigint not null references job_attempts(id),
  kind            text not null check (kind in ('SINGLE','CHILD','CAROUSEL')),
  container_id    text not null unique,
  created_at      timestamptz not null default now()
);

create table post_publications (
  post_id       uuid primary key references posts(id),   -- 1投稿1公開（二重公開の最後の砦）
  ig_media_id   text not null unique,
  permalink     text not null,
  published_at  timestamptz not null,
  recorded_at   timestamptz not null default now()
);

create table post_failures (
  id            bigint generated always as identity primary key,
  post_id       uuid not null references posts(id),
  event_id      bigint not null unique references post_events(id),
  failure_kind  text not null check (failure_kind in
                  ('TRANSIENT','RATE_LIMITED','TOKEN_INVALID','MEDIA_REJECTED','GRACE_EXCEEDED','UNKNOWN')),
  message       text not null check (char_length(message) between 1 and 500)
);
