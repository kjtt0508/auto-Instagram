-- テスト専用: Supabase が本番で用意しているもの（auth スキーマ・ロール）の最小限の代役
-- 本番の Supabase ではこのファイルは流さない（src/test/resources にだけ置く）

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id     uuid primary key,
  email  text not null
);

-- Supabase と同じく、リクエストの JWT のクレームを request.jwt.claims から読む
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

-- Supabase の既定の権限（public のテーブルは anon / authenticated に付与され、RLS で絞る）
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Supabase Storage の最小の代役（V7 のバケット・ポリシーが作られ、団体ごとの境界をテストで確かめられるように）
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id      text primary key,
  name    text not null,
  public  boolean not null default false
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets(id),
  name       text not null
);
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
-- Supabase と同じく、パスのフォルダ部分（最後の要素を除く）を配列で返す
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
