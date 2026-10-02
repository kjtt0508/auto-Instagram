-- 投稿（docs/design/01_DB設計.md 2.4）
-- 画像仕様・文字数などの業務ルールは CHECK にしない（ドメインが持つ。ADR-0005）

create table posts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now()
);

create table post_revisions (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references posts(id),
  revision_no      int  not null check (revision_no >= 1),
  format           text not null check (format in ('FEED_IMAGE','CAROUSEL')),
  media_source     text not null check (media_source in ('UPLOAD','TEMPLATE')),
  caption          text not null,          -- PR表記を含まない本文
  pr_category      text not null check (pr_category in ('NONE','PR')),
  genre_id         uuid references genres(id),  -- nullable: 承認依頼までは未選択でよい（Post.requestApproval で必須）
  generation_id    uuid,                   -- nullable: 人が手で書いた版。生成テーブルへの FK はフェーズ2で追加
  created_by       uuid not null references members(id),
  created_at       timestamptz not null default now(),
  unique (post_id, revision_no)
);

create table post_media (               -- media_source = UPLOAD の版の画像
  id            uuid primary key default gen_random_uuid(),
  revision_id   uuid not null references post_revisions(id),
  position      int  not null check (position >= 1),
  storage_path  text not null,
  width         int  not null check (width > 0),
  height        int  not null check (height > 0),
  byte_size     int  not null check (byte_size > 0),
  unique (revision_id, position)
);

create table post_status_transitions (  -- 出来事の種類と遷移の組（domain.yaml 投稿状態・投稿履歴）
  event_type   text not null,
  from_status  text not null,
  to_status    text not null,
  primary key (event_type, from_status, to_status)
);
insert into post_status_transitions (event_type, from_status, to_status) values
  ('CREATED',            'NEW',               'DRAFT'),
  ('APPROVAL_REQUESTED', 'DRAFT',             'AWAITING_APPROVAL'),
  ('DISCARDED',          'DRAFT',             'DISCARDED'),
  ('APPROVED',           'AWAITING_APPROVAL', 'SCHEDULED'),
  ('REVISION_REQUESTED', 'AWAITING_APPROVAL', 'DRAFT'),
  ('DISCARDED',          'AWAITING_APPROVAL', 'DISCARDED'),
  ('PUBLISH_STARTED',    'SCHEDULED',         'PUBLISHING'),
  ('SCHEDULE_CANCELLED', 'SCHEDULED',         'DRAFT'),
  ('FAILED',             'SCHEDULED',         'FAILED'),
  ('PUBLISHED',          'PUBLISHING',        'PUBLISHED'),
  ('FAILED',             'PUBLISHING',        'FAILED'),
  ('PUBLISH_DEFERRED',   'PUBLISHING',        'SCHEDULED'),
  ('RETRIED',            'FAILED',            'SCHEDULED'),
  ('RETURNED_TO_DRAFT',  'FAILED',            'DRAFT'),
  ('DISCARDED',          'FAILED',            'DISCARDED');

create table post_events (
  id               bigint generated always as identity primary key,
  post_id          uuid not null references posts(id),
  event_type       text not null,
  from_status      text not null,
  to_status        text not null,
  revision_id      uuid references post_revisions(id),  -- nullable: 予約取消・公開開始など内容の版に関係しない出来事
  actor_member_id  uuid references members(id),         -- nullable: 定期処理による出来事
  note             text check (char_length(note) <= 500), -- nullable: 修正指示・取消理由がある出来事だけ
  occurred_at      timestamptz not null default now(),
  foreign key (event_type, from_status, to_status)
    references post_status_transitions (event_type, from_status, to_status)
);
create index post_events_post_idx on post_events (post_id, id desc);

create table post_schedules (
  id            bigint generated always as identity primary key,
  post_id       uuid not null references posts(id),
  event_id      bigint not null unique references post_events(id),
  scheduled_at  timestamptz not null,
  decided_by    uuid not null references members(id)
);
