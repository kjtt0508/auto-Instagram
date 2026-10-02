-- 団体・メンバー（docs/design/01_DB設計.md 2.2）
-- 区分・状態の値は docs/model/domain.yaml の code と一致させる

create extension if not exists pgcrypto;
create extension if not exists citext;
create schema if not exists app;

create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  created_at  timestamptz not null default now()
);

create table members (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  email         citext not null check (email ~ '^[^@\s]+@[^@\s]+$'),
  display_name  text not null check (char_length(display_name) between 1 and 50),
  invited_by    uuid references members(id),     -- nullable: 最初の管理者は SQL で登録するため招待者がいない
  created_at    timestamptz not null default now(),
  unique (tenant_id, email)
);

create table member_auth_links (
  member_id     uuid primary key references members(id),
  auth_user_id  uuid not null unique references auth.users(id),
  linked_at     timestamptz not null default now()
);

create table member_role_changes (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references members(id),
  role        text not null check (role in ('ADMIN','APPROVER','EDITOR')),
  changed_by  uuid references members(id),       -- nullable: 最初の管理者の登録
  changed_at  timestamptz not null default now()
);

create table member_deactivations (
  member_id       uuid primary key references members(id),
  deactivated_by  uuid not null references members(id),
  reason          text not null check (char_length(reason) between 1 and 200),
  deactivated_at  timestamptz not null default now()
);

create table tenant_settings (
  id                     bigint generated always as identity primary key,
  tenant_id              uuid not null references tenants(id),
  version                int  not null check (version >= 1),
  llm_provider           text not null check (llm_provider in ('GEMINI')),
  llm_model              text not null check (char_length(llm_model) between 1 and 100),
  llm_daily_limit        int  not null check (llm_daily_limit >= 1),
  llm_warn_ratio         numeric(3,2) not null check (llm_warn_ratio > 0 and llm_warn_ratio <= 1),
  publish_grace_minutes  int  not null check (publish_grace_minutes >= 1),
  pr_label               text not null check (char_length(pr_label) >= 1),
  auto_draft_enabled     boolean not null,
  created_by             uuid references members(id),   -- nullable: 初期設定は SQL で登録
  created_at             timestamptz not null default now(),
  unique (tenant_id, version)
);

create table genres (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  name       text not null check (char_length(name) between 1 and 20),
  unique (tenant_id, name)
);
