-- Instagram連携（docs/design/01_DB設計.md 2.3）

create table oauth_states (           -- 使い捨て（使用時に DELETE）。ADR-0006
  state       text primary key,
  tenant_id   uuid not null references tenants(id),
  member_id   uuid not null references members(id),
  expires_at  timestamptz not null
);

create table instagram_connections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  ig_user_id    text not null,
  ig_username   text not null,
  account_type  text not null check (account_type in ('BUSINESS','MEDIA_CREATOR')),
  connected_by  uuid not null references members(id),
  connected_at  timestamptz not null default now()
);

create table instagram_token_grants (
  id                 bigint generated always as identity primary key,
  connection_id      uuid not null references instagram_connections(id),
  grant_kind         text not null check (grant_kind in ('INITIAL','REFRESH')),
  token_ciphertext   bytea not null,
  token_iv           bytea not null check (octet_length(token_iv) = 12),
  key_version        smallint not null check (key_version >= 1),
  expires_at         timestamptz not null,
  granted_at         timestamptz not null default now()
);

create table instagram_token_refresh_failures (
  id             bigint generated always as identity primary key,
  connection_id  uuid not null references instagram_connections(id),
  failure_kind   text not null check (failure_kind in ('TRANSIENT','RATE_LIMITED','TOKEN_INVALID','UNKNOWN')),
  message        text not null,
  failed_at      timestamptz not null default now()
);

create table instagram_disconnections (
  connection_id    uuid primary key references instagram_connections(id),
  disconnected_by  uuid not null references members(id),
  disconnected_at  timestamptz not null default now()
);
