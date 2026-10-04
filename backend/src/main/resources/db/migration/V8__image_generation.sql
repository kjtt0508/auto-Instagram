-- 画像生成（REQ-005 設計 5章、ADR-0008, ADR-0009）
-- 画像生成と候補の採用は追記のみ。回数のカウンタだけ UPDATE を許す。LLM利用回数（英訳）は 01_DB設計の llm_usage_daily を前倒しで作る
-- 生成画像であることは、投稿の版の保存（save_post_revision）と同じ時点で記録・検証する（設計レビューの Critical）

-- ───────── 設定（版で管理） ─────────
create table image_generation_settings (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references tenants(id),
  version      int  not null check (version >= 1),
  provider     text not null check (provider in ('CLOUDFLARE_WORKERS_AI')),
  model        text not null check (char_length(model) between 1 and 100),
  daily_limit  int  not null check (daily_limit >= 1),
  warn_ratio   numeric(3,2) not null check (warn_ratio > 0 and warn_ratio <= 1),
  created_by   uuid references members(id),   -- nullable: 初版は V8・初期データの SQL で登録するため作成者がいない
  created_at   timestamptz not null default now(),
  unique (tenant_id, version)
);

create view image_generation_settings_current with (security_invoker = true) as
select distinct on (tenant_id) * from image_generation_settings order by tenant_id, version desc;

-- 既存の団体に初版（Workers AI の FLUX.1 [schnell]・1日20回・8割で警告。ADR-0008）
insert into image_generation_settings (tenant_id, version, provider, model, daily_limit, warn_ratio)
select id, 1, 'CLOUDFLARE_WORKERS_AI', '@cf/black-forest-labs/flux-1-schnell', 20, 0.80 from tenants;

-- ───────── 画像生成と候補の採用（追記のみ） ─────────
create table image_generations (
  id               uuid primary key,              -- API関数が採番する（候補の保存先 candidates/{id}/ に使う）
  tenant_id        uuid not null references tenants(id),
  requested_by     uuid not null references members(id),
  style            text not null check (style in ('ILLUSTRATION','PHOTOREALISTIC')),
  prompt_ja        text not null check (char_length(prompt_ja) between 1 and 500),
  prompt_en        text not null check (char_length(prompt_en) >= 1),
  provider         text not null check (char_length(provider) >= 1),
  model            text not null check (char_length(model) >= 1),
  outcome          text not null check (outcome in ('SUCCEEDED','FAILED')),
  candidate_count  int  not null check (candidate_count between 0 and 4),
  requested_at     timestamptz not null default now(),
  check ((outcome = 'SUCCEEDED') = (candidate_count >= 1))
);

-- 候補を投稿の版の投稿画像に入れた（版の保存と同じ時点。投稿画像1枚に1つ）
create table candidate_adoptions (
  post_media_id       uuid primary key references post_media(id),
  generation_id       uuid not null references image_generations(id),
  candidate_position  int  not null check (candidate_position between 1 and 4),
  adopted_by          uuid not null references members(id),
  adopted_at          timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['image_generation_settings','image_generations','candidate_adoptions'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function app.forbid_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- 投稿画像が生成画像か（どの画像生成の何番目か・画像の種類）を導出する。投稿画像にカラムは足さない（P31）
create view post_media_origin with (security_invoker = true) as
select pm.id as post_media_id, pm.revision_id, pm.position, pm.storage_path, pm.width, pm.height, pm.byte_size,
       ca.generation_id, ca.candidate_position, ig.style
from post_media pm
left join candidate_adoptions ca on ca.post_media_id = pm.id
left join image_generations ig on ig.id = ca.generation_id;

-- ───────── 回数（カウンタ。UPDATE を許す） ─────────
-- 日の区切り（確保と参照で同じ関数を使う）
create function app.image_generation_day() returns date language sql stable as $$
  select (now() at time zone 'UTC')::date          -- = 日本時間 9:00 区切り（Workers AI の無料枠のリセット）
$$;
create function app.llm_day() returns date language sql stable as $$
  select (now() at time zone 'America/Los_Angeles')::date   -- Gemini の日次上限のリセット（01_DB設計。要確認）
$$;

create table image_generation_usage_daily (     -- ADR-0009
  tenant_id   uuid not null references tenants(id),
  usage_date  date not null,
  count       int  not null check (count >= 0),
  primary key (tenant_id, usage_date)
);

create table llm_usage_daily (                  -- ADR-0006（01_DB設計の設計どおり。REQ-002 から前倒し）
  tenant_id   uuid not null references tenants(id),
  usage_date  date not null,
  model       text not null check (char_length(model) >= 1),
  count       int  not null check (count >= 0),
  primary key (tenant_id, usage_date, model)
);

-- 1回分を確保する。上限に達していたら allowed = false（同時に呼ばれても上限を超えない。NFR-005-03）
create function public.try_consume_image_generation(p_tenant uuid, p_limit int) returns table (allowed boolean, used int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := app.image_generation_day(); c int;
begin
  -- harness-allow: P18 ADR-0009（画像生成の回数のカウンタ）
  insert into image_generation_usage_daily as u (tenant_id, usage_date, count) values (p_tenant, d, 1)
  on conflict (tenant_id, usage_date) do update set count = u.count + 1 where u.count < p_limit
  returning u.count into c;
  if c is null then
    select u.count into c from image_generation_usage_daily u where u.tenant_id = p_tenant and u.usage_date = d;
    return query select false, c;
    return;
  end if;
  return query select true, c;
end $$;

create function public.try_consume_llm(p_tenant uuid, p_model text, p_limit int) returns table (allowed boolean, used int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := app.llm_day(); c int;
begin
  -- harness-allow: P18 ADR-0006（LLM利用回数のカウンタ）
  insert into llm_usage_daily as u (tenant_id, usage_date, model, count) values (p_tenant, d, p_model, 1)
  on conflict (tenant_id, usage_date, model) do update set count = u.count + 1 where u.count < p_limit
  returning u.count into c;
  if c is null then
    select u.count into c from llm_usage_daily u where u.tenant_id = p_tenant and u.usage_date = d and u.model = p_model;
    return query select false, c;
    return;
  end if;
  return query select true, c;
end $$;

-- 今日の画像生成の回数（確保しない。事前確認と画面の残り回数に使う）
create function public.image_generation_usage_of(p_tenant uuid) returns table (used int, daily_limit int, warn_ratio numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select u.count from image_generation_usage_daily u
                    where u.tenant_id = p_tenant and u.usage_date = app.image_generation_day()), 0),
         s.daily_limit, s.warn_ratio
    from image_generation_settings_current s where s.tenant_id = p_tenant
$$;

-- 画面用（ログイン中のメンバーの団体）
create function public.image_generation_usage() returns table (used int, daily_limit int, warn_ratio numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.* from app.current_member() cm, public.image_generation_usage_of(cm.tenant_id) u
$$;

-- ───────── 記録（API関数だけが呼ぶ） ─────────
create function public.record_image_generation(
  p_id uuid, p_tenant uuid, p_member uuid, p_style text, p_prompt_ja text, p_prompt_en text,
  p_provider text, p_model text, p_outcome text, p_candidate_count int) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into image_generations (id, tenant_id, requested_by, style, prompt_ja, prompt_en, provider, model, outcome, candidate_count)
  values (p_id, p_tenant, p_member, p_style, p_prompt_ja, p_prompt_en, p_provider, p_model, p_outcome, p_candidate_count)
$$;

-- ───────── 下書きの保存（V7 を置き換え）: 候補の参照を確かめて候補の採用を記録し、保存先を {団体}/posts/ に限る ─────────
-- p_revision: {format, mediaSource, caption, prCategory, genreId?,
--              media:[{position, storagePath, width, height, byteSize, generation?: {generationId, candidatePosition}}]}
create function app.adopt_candidate(p_media uuid, p_tenant uuid, p_member uuid, p_generation jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; pos int := (p_generation ->> 'candidatePosition')::int;
begin
  select * into g from image_generations
   where id = (p_generation ->> 'generationId')::uuid and tenant_id = p_tenant and outcome = 'SUCCEEDED';
  if g.id is null or pos is null or pos < 1 or pos > g.candidate_count then
    raise exception '候補の参照が正しくありません。画像を選び直してください' using errcode = '22023';
  end if;
  insert into candidate_adoptions (post_media_id, generation_id, candidate_position, adopted_by)
  values (p_media, g.id, pos, p_member);
end $$;

create or replace function public.save_post_revision(p_post uuid, p_revision jsonb) returns table (post_id uuid, revision_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_post uuid := p_post; rev uuid; next_no int; item jsonb; media_id uuid;
begin
  select * into me from app.require_member();
  if v_post is null then
    insert into posts (tenant_id, created_by) values (me.tenant_id, me.member_id) returning id into v_post;
  else
    perform app.lock_own_post(v_post, me.tenant_id);
  end if;
  select coalesce(max(r.revision_no), 0) + 1 into next_no from post_revisions r where r.post_id = v_post;
  insert into post_revisions (post_id, revision_no, format, media_source, caption, pr_category, genre_id, created_by)
  values (v_post, next_no, p_revision ->> 'format', p_revision ->> 'mediaSource', p_revision ->> 'caption',
          p_revision ->> 'prCategory', nullif(p_revision ->> 'genreId', '')::uuid, me.member_id)
  returning id into rev;
  for item in select * from jsonb_array_elements(coalesce(p_revision -> 'media', '[]'::jsonb)) loop
    if position((me.tenant_id::text || '/posts/') in (item ->> 'storagePath')) <> 1 then
      raise exception '投稿画像の保存先が正しくありません' using errcode = '42501';
    end if;
    insert into post_media (revision_id, position, storage_path, width, height, byte_size)
    values (rev, (item ->> 'position')::int, item ->> 'storagePath', (item ->> 'width')::int,
            (item ->> 'height')::int, (item ->> 'byteSize')::int)
    returning id into media_id;
    if item ? 'generation' and jsonb_typeof(item -> 'generation') = 'object' then
      perform app.adopt_candidate(media_id, me.tenant_id, me.member_id, item -> 'generation');
    end if;
  end loop;
  if next_no = 1 then
    insert into post_events (post_id, event_type, from_status, to_status, revision_id, actor_member_id)
    values (v_post, 'CREATED', 'NEW', 'DRAFT', rev, me.member_id);
  end if;
  return query select v_post, rev;
end $$;

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array['image_generation_settings','image_generations','candidate_adoptions',
                           'image_generation_usage_daily','llm_usage_daily'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy image_generation_settings_read on image_generation_settings for select to authenticated using (app.is_member(tenant_id));
create policy image_generations_read on image_generations for select to authenticated using (app.is_member(tenant_id));
create policy candidate_adoptions_read on candidate_adoptions for select to authenticated
  using (exists (select 1 from image_generations g where g.id = generation_id and app.is_member(g.tenant_id)));
create policy image_generation_usage_daily_read on image_generation_usage_daily for select to authenticated using (app.is_member(tenant_id));
create policy llm_usage_daily_read on llm_usage_daily for select to authenticated using (app.is_member(tenant_id));

-- ───────── Storage: メンバーが書けるのは {団体}/posts/ だけ（候補 candidates/ は service role だけ） ─────────
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage スキーマが無いため、ポリシーを作り直しません';
    return;
  end if;
  drop policy if exists uploads_private_insert on storage.objects;
  create policy uploads_private_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'uploads-private'
                and (storage.foldername(name))[2] = 'posts'
                and exists (select 1 from app.current_member() cm
                             where cm.tenant_id::text = (storage.foldername(name))[1]));
end $$;

-- ───────── 権限 ─────────
revoke execute on function app.image_generation_day(), app.llm_day(), app.adopt_candidate(uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.try_consume_image_generation(uuid, int), public.try_consume_llm(uuid, text, int),
  public.image_generation_usage_of(uuid),
  public.record_image_generation(uuid, uuid, uuid, text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.try_consume_image_generation(uuid, int), public.try_consume_llm(uuid, text, int),
  public.image_generation_usage_of(uuid),
  public.record_image_generation(uuid, uuid, uuid, text, text, text, text, text, text, int) to service_role;

revoke execute on function public.image_generation_usage() from public, anon;
grant execute on function public.image_generation_usage() to authenticated;
