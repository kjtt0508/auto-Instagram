-- AIで下書きを生成する（REQ-002 設計 5章、ADR-0005, ADR-0010）
-- 追記のみ。例外は post_failures の失敗区分の CHECK の付け替え（RENDER_FAILED を足す）。
-- DB の検査は「形」だけ（役割の並び・件数・参照の正しさ・保存先のパス・テンプレートの版の照合・強調の範囲）。
-- 文字数・表紙の対象の候補・強調の重なりはドメイン（TS・Java）が検査する。
-- save_post_revision の UPLOAD の動きは V8 と同じ。approve_post は UPLOAD の動きを変えない。

-- ───────── ネタ ─────────
create table ideas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  source      text not null check (source = 'MEMO'),      -- REQ-002 は運営メモだけ。REQ-003 で広げる
  body        text not null check (char_length(body) >= 1),
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now()
);

-- ───────── プロンプト版（版で管理。用途ごとに有効な版は最後の有効化） ─────────
create table prompt_versions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  purpose     text not null check (purpose in ('PLAN','CAPTION','REVISE')),
  version_no  int  not null check (version_no >= 1),
  body        text not null check (char_length(body) >= 1),
  created_by  uuid references members(id),                -- nullable: 初版は V10・seed で登録するため作成者がいない
  created_at  timestamptz not null default now(),
  unique (tenant_id, purpose, version_no)
);

create table prompt_activations (
  id                bigint generated always as identity primary key,
  prompt_version_id uuid not null references prompt_versions(id),
  activated_by      uuid references members(id),          -- nullable: 初版は V10・seed で有効にするため
  activated_at      timestamptz not null default now()
);

create view active_prompt_versions with (security_invoker = true) as
select distinct on (v.tenant_id, v.purpose)
       v.tenant_id, v.purpose, v.id as prompt_version_id, v.version_no, v.body, a.activated_at
  from prompt_activations a join prompt_versions v on v.id = a.prompt_version_id
 order by v.tenant_id, v.purpose, a.id desc;

-- ───────── 生成（LLM に下書き案を作らせた依頼1回。失敗も残す） ─────────
create table generations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id),
  requested_by       uuid not null references members(id),
  purpose            text not null check (purpose in ('PLAN','CAPTION','REVISE')),
  route              text not null check (route in ('API','MANUAL')),
  idea_id            uuid not null references ideas(id),
  prompt_version_id  uuid not null references prompt_versions(id),
  input              jsonb not null,                       -- LLM に渡した入力（GenerationInput）。入稿者連絡先の欄は無い
  outcome            text not null check (outcome in ('SUCCEEDED','INVALID_OUTPUT','LLM_ERROR','QUOTA_EXCEEDED','TIMEOUT')),
  requested_at       timestamptz not null default now(),
  check (route = 'API' or outcome in ('SUCCEEDED','INVALID_OUTPUT'))
);
create index generations_idea_idx on generations (idea_id);

create table generation_attempts (                       -- LLM 呼び出し1回（手動コピペは呼び出しが無いので行が無い）
  id             bigint generated always as identity primary key,
  generation_id  uuid not null references generations(id),
  attempt_no     int  not null check (attempt_no >= 1),
  model          text not null check (char_length(model) >= 1),
  raw_output     text not null,                          -- 呼び出しが出力を返さなかったときは空文字（欠損ではなく「出力が無い」という値）
  violations     jsonb not null check (jsonb_typeof(violations) = 'array'),
  attempted_at   timestamptz not null default now(),
  unique (generation_id, attempt_no)
);

create table generation_results (                        -- 成功した下書き案
  generation_id  uuid primary key references generations(id),
  proposal       jsonb not null check (jsonb_typeof(proposal) = 'object'),
  recorded_at    timestamptz not null default now()
);

create table generation_revisions (                      -- 修正指示（親の生成・指示）
  generation_id         uuid primary key references generations(id),
  parent_generation_id  uuid not null references generations(id),
  instruction           text not null check (char_length(instruction) >= 1),
  check (generation_id <> parent_generation_id)
);

-- ───────── 投稿の型の設定（版で管理。リポジトリには文面を置かない。ADR-0010） ─────────
create table post_style_settings (
  id                    bigint generated always as identity primary key,
  tenant_id             uuid not null references tenants(id),
  version               int  not null check (version >= 1),
  band_text             text not null,
  cover_targets         text[] not null check (cardinality(cover_targets) >= 1),
  closing_message       text not null,
  account_introduction  text not null,
  caption_footer        text not null check (char_length(caption_footer) >= 1),
  fixed_hashtags        text[] not null,
  created_by            uuid not null references members(id),
  created_at            timestamptz not null default now(),
  unique (tenant_id, version)
);

create view post_style_settings_current with (security_invoker = true) as
select distinct on (tenant_id) * from post_style_settings order by tenant_id, version desc;

create table post_style_logos (                          -- ロゴが無ければ行が無い
  style_settings_id  bigint primary key references post_style_settings(id),
  storage_path       text not null check (char_length(storage_path) >= 1)
);

-- ───────── 背景写真 ─────────
create table background_photos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  storage_path   text not null unique,
  description    text not null check (char_length(description) between 1 and 100),
  registered_by  uuid not null references members(id),
  registered_at  timestamptz not null default now()
);

create table background_photo_retirements (              -- 「使わない」にした出来事（写真は消さない）
  background_photo_id  uuid primary key references background_photos(id),
  retired_by           uuid not null references members(id),
  retired_at           timestamptz not null default now()
);

create view usable_background_photos with (security_invoker = true) as
select p.* from background_photos p
 where not exists (select 1 from background_photo_retirements r where r.background_photo_id = p.id);

-- ───────── テンプレートの版 ─────────
create table template_releases (
  version      text primary key check (char_length(version) >= 1),
  released_at  timestamptz not null default now()
);
insert into template_releases (version) values ('niijima@1');

-- ───────── 投稿の版（TEMPLATE）の中身 ─────────
create table revision_templates (
  revision_id        uuid primary key references post_revisions(id),
  template_version   text not null references template_releases(version),
  style_settings_id  bigint not null references post_style_settings(id)
);

create table revision_generations (                      -- post_revisions.generation_id は使わない（常に NULL）
  revision_id    uuid primary key references post_revisions(id),
  generation_id  uuid not null references generations(id)
);

create table post_slides (
  id           uuid primary key default gen_random_uuid(),
  revision_id  uuid not null references post_revisions(id),
  position     int  not null check (position between 1 and 10),
  role         text not null check (role in ('COVER','BODY','CLOSING')),
  unique (revision_id, position),
  unique (id, role)
);

create table cover_slides (
  slide_id      uuid primary key,
  role          text not null default 'COVER' check (role = 'COVER'),
  target        text not null,
  keyword       text not null,
  annotation    text not null,                           -- 添え書き。無いときは空文字（表紙の文言の値として普通にある状態）
  closing_words text not null,                           -- 締めの言葉
  accent        text not null check (accent in ('PURPLE','RED','TEAL')),
  foreign key (slide_id, role) references post_slides(id, role)
);

create table cover_backgrounds (                         -- 背景写真が無ければ行が無い（紺の単色）
  slide_id             uuid primary key references cover_slides(slide_id),
  background_photo_id  uuid not null references background_photos(id)
);

create table body_slides (
  slide_id           uuid primary key,
  role               text not null default 'BODY' check (role = 'BODY'),
  heading            text not null,
  description        text not null,
  picture_prompt     text not null,
  needs_replacement  boolean not null,
  foreign key (slide_id, role) references post_slides(id, role)
);

create table body_emphases (                             -- 位置と長さはコードポイントで数える
  slide_id   uuid not null references body_slides(slide_id),
  seq        int  not null check (seq >= 1),
  start_cp   int  not null check (start_cp >= 0),
  length_cp  int  not null check (length_cp >= 1),
  primary key (slide_id, seq)
);

create table body_materials (                            -- 素材画像（無ければ行が無い＝文字だけのカード）
  slide_id      uuid primary key references body_slides(slide_id),
  storage_path  text not null,
  width         int  not null check (width > 0),
  height        int  not null check (height > 0),
  byte_size     int  not null check (byte_size > 0)
);

create table material_adoptions (                        -- 素材画像としての採用（候補の採用と同じ条件）
  slide_id            uuid primary key references body_materials(slide_id),
  generation_id       uuid not null references image_generations(id),
  candidate_position  int  not null check (candidate_position between 1 and 4),
  adopted_by          uuid not null references members(id),
  adopted_at          timestamptz not null default now()
);

create table revision_hashtags (                         -- 追加のハッシュタグ（個数の上限はドメインが検査する）
  revision_id  uuid not null references post_revisions(id),
  position     int  not null check (position >= 1),
  hashtag      text not null check (char_length(hashtag) >= 1),
  primary key (revision_id, position)
);

-- ───────── 承認ごとの記録 ─────────
create table approval_past_posts (                       -- 承認の出来事ごとに選んだ過去の投稿（0件なら行が無い）
  approval_event_id    bigint not null references post_events(id),
  position             int    not null check (position between 1 and 2),
  past_post_id         uuid   not null references posts(id),
  cover_storage_path   text   not null check (char_length(cover_storage_path) >= 1),
  primary key (approval_event_id, position),
  unique (approval_event_id, past_post_id)
);

create table template_renders (                          -- 画像化した JPEG（uploads-private/{団体}/renders/ ）
  id                 uuid primary key default gen_random_uuid(),
  approval_event_id  bigint not null references post_events(id),
  position           int    not null check (position >= 1),
  storage_path       text   not null unique,
  width              int    not null check (width > 0),
  height             int    not null check (height > 0),
  byte_size          int    not null check (byte_size > 0),
  rendered_at        timestamptz not null default now(),
  unique (approval_event_id, position)
);

create table template_publish_media (                    -- TEMPLATE の版の公開用 JPEG（UPLOAD の publish_media は変えない）
  id                 uuid primary key default gen_random_uuid(),
  revision_id        uuid   not null references post_revisions(id),
  approval_event_id  bigint not null references post_events(id),
  position           int    not null check (position >= 1),
  storage_path       text   not null unique,
  width              int    not null check (width > 0),
  height             int    not null check (height > 0),
  byte_size          int    not null check (byte_size > 0),
  prepared_at        timestamptz not null default now(),
  unique (revision_id, approval_event_id, position)
);

-- ───────── 失敗区分に RENDER_FAILED（画像化の失敗）を足す ─────────
alter table post_failures drop constraint post_failures_failure_kind_check;
alter table post_failures add constraint post_failures_failure_kind_check check (failure_kind in
  ('TRANSIENT','RATE_LIMITED','TOKEN_INVALID','MEDIA_REJECTED','GRACE_EXCEEDED','UNKNOWN','RENDER_FAILED'));

-- ───────── 版に含まれる生成画像（AI生成の表示・承認時の確認はこのビューだけを読む） ─────────
create view revision_generated_styles with (security_invoker = true) as
select o.revision_id, o.position, 'POST_MEDIA'::text as origin, o.generation_id, o.candidate_position, o.style
  from post_media_origin o
 where o.generation_id is not null
union all
select s.revision_id, s.position, 'MATERIAL'::text as origin, ma.generation_id, ma.candidate_position, ig.style
  from material_adoptions ma
  join post_slides s on s.id = ma.slide_id
  join image_generations ig on ig.id = ma.generation_id;

-- ───────── 追記のみ ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'ideas','prompt_versions','prompt_activations','generations','generation_attempts','generation_results',
    'generation_revisions','post_style_settings','post_style_logos','background_photos','background_photo_retirements',
    'template_releases','revision_templates','revision_generations','post_slides','cover_slides','cover_backgrounds',
    'body_slides','body_emphases','body_materials','material_adoptions','revision_hashtags','approval_past_posts',
    'template_renders','template_publish_media']
  loop
    execute format('create trigger %I before update or delete on %I for each row execute function app.forbid_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- ───────── 読むための部品（RLS のポリシーが使う） ─────────
create function app.can_read_generation(g uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from generations x where x.id = g and app.is_member(x.tenant_id))
$$;
create function app.can_read_prompt_version(v uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from prompt_versions x where x.id = v and app.is_member(x.tenant_id))
$$;
create function app.can_read_style_settings(s bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from post_style_settings x where x.id = s and app.is_member(x.tenant_id))
$$;
create function app.can_read_background_photo(b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from background_photos x where x.id = b and app.is_member(x.tenant_id))
$$;
create function app.can_read_slide(s uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from post_slides x where x.id = s and app.can_read_revision(x.revision_id))
$$;
create function app.can_read_approval_event(e bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from post_events x where x.id = e and app.can_read_post(x.post_id))
$$;

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'ideas','prompt_versions','prompt_activations','generations','generation_attempts','generation_results',
    'generation_revisions','post_style_settings','post_style_logos','background_photos','background_photo_retirements',
    'template_releases','revision_templates','revision_generations','post_slides','cover_slides','cover_backgrounds',
    'body_slides','body_emphases','body_materials','material_adoptions','revision_hashtags','approval_past_posts',
    'template_renders','template_publish_media']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy ideas_read on ideas for select to authenticated using (app.is_member(tenant_id));
create policy prompt_versions_read on prompt_versions for select to authenticated using (app.is_member(tenant_id));
create policy prompt_activations_read on prompt_activations for select to authenticated
  using (app.can_read_prompt_version(prompt_version_id));
create policy generations_read on generations for select to authenticated using (app.is_member(tenant_id));
create policy generation_attempts_read on generation_attempts for select to authenticated using (app.can_read_generation(generation_id));
create policy generation_results_read on generation_results for select to authenticated using (app.can_read_generation(generation_id));
create policy generation_revisions_read on generation_revisions for select to authenticated using (app.can_read_generation(generation_id));
create policy post_style_settings_read on post_style_settings for select to authenticated using (app.is_member(tenant_id));
create policy post_style_logos_read on post_style_logos for select to authenticated
  using (app.can_read_style_settings(style_settings_id));
create policy background_photos_read on background_photos for select to authenticated using (app.is_member(tenant_id));
create policy background_photo_retirements_read on background_photo_retirements for select to authenticated
  using (app.can_read_background_photo(background_photo_id));
create policy template_releases_read on template_releases for select to authenticated using (true);
create policy revision_templates_read on revision_templates for select to authenticated using (app.can_read_revision(revision_id));
create policy revision_generations_read on revision_generations for select to authenticated using (app.can_read_revision(revision_id));
create policy post_slides_read on post_slides for select to authenticated using (app.can_read_revision(revision_id));
create policy cover_slides_read on cover_slides for select to authenticated using (app.can_read_slide(slide_id));
create policy cover_backgrounds_read on cover_backgrounds for select to authenticated using (app.can_read_slide(slide_id));
create policy body_slides_read on body_slides for select to authenticated using (app.can_read_slide(slide_id));
create policy body_emphases_read on body_emphases for select to authenticated using (app.can_read_slide(slide_id));
create policy body_materials_read on body_materials for select to authenticated using (app.can_read_slide(slide_id));
create policy material_adoptions_read on material_adoptions for select to authenticated using (app.can_read_slide(slide_id));
create policy revision_hashtags_read on revision_hashtags for select to authenticated using (app.can_read_revision(revision_id));
create policy approval_past_posts_read on approval_past_posts for select to authenticated
  using (app.can_read_approval_event(approval_event_id));
create policy template_renders_read on template_renders for select to authenticated
  using (app.can_read_approval_event(approval_event_id));
create policy template_publish_media_read on template_publish_media for select to authenticated
  using (app.can_read_revision(revision_id));
-- 書くポリシーは付けない（管理者・保存・承認の RPC と service role だけが書く）。さらに画面のロールの書き込み権限も外す
do $$
declare t text;
begin
  foreach t in array array[
    'ideas','prompt_versions','prompt_activations','generations','generation_attempts','generation_results',
    'generation_revisions','post_style_settings','post_style_logos','background_photos','background_photo_retirements',
    'template_releases','revision_templates','revision_generations','post_slides','cover_slides','cover_backgrounds',
    'body_slides','body_emphases','body_materials','material_adoptions','revision_hashtags','approval_past_posts',
    'template_renders','template_publish_media','active_prompt_versions','post_style_settings_current',
    'usable_background_photos','revision_generated_styles']
  loop
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
  end loop;
end $$;

-- ───────── 受け取った JSON の形を確かめる部品（形が違えば 22023） ─────────
create function app.json_text(o jsonb, k text) returns text
language plpgsql immutable as $$
begin
  if jsonb_typeof(o -> k) is distinct from 'string' then
    raise exception '% は文字列で指定してください', k using errcode = '22023';
  end if;
  return o ->> k;
end $$;

create function app.json_text_or(o jsonb, k text, d text) returns text
language plpgsql immutable as $$
begin
  if o -> k is null or jsonb_typeof(o -> k) = 'null' then
    return d;
  end if;
  return app.json_text(o, k);
end $$;

create function app.json_int(o jsonb, k text) returns int
language plpgsql immutable as $$
begin
  if jsonb_typeof(o -> k) is distinct from 'number' or (o ->> k) !~ '^-?[0-9]{1,9}$' then
    raise exception '% は整数で指定してください', k using errcode = '22023';
  end if;
  return (o ->> k)::int;
end $$;

create function app.json_bool_or(o jsonb, k text, d boolean) returns boolean
language plpgsql immutable as $$
begin
  if o -> k is null or jsonb_typeof(o -> k) = 'null' then
    return d;
  end if;
  if jsonb_typeof(o -> k) <> 'boolean' then
    raise exception '% は真偽値で指定してください', k using errcode = '22023';
  end if;
  return (o ->> k)::boolean;
end $$;

create function app.json_uuid_or_null(o jsonb, k text) returns uuid
language plpgsql immutable as $$
begin
  if o -> k is null or jsonb_typeof(o -> k) = 'null' then
    return null;
  end if;
  if jsonb_typeof(o -> k) <> 'string'
     or (o ->> k) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception '% は ID で指定してください', k using errcode = '22023';
  end if;
  return (o ->> k)::uuid;
end $$;

-- ───────── 採用できる候補の検査（候補の採用と素材画像としての採用で共通。REQ-005 の動きは変えない） ─────────
create function app.require_adoptable_candidate(p_tenant uuid, p_generation jsonb)
returns table (generation_id uuid, candidate_position int)
language plpgsql security definer set search_path = public, pg_temp as $$
declare g record; pos int := (p_generation ->> 'candidatePosition')::int;
begin
  select * into g from image_generations
   where id = (p_generation ->> 'generationId')::uuid and tenant_id = p_tenant and outcome = 'SUCCEEDED';
  if g.id is null or pos is null or pos < 1 or pos > g.candidate_count then
    raise exception '候補の参照が正しくありません。画像を選び直してください' using errcode = '22023';
  end if;
  return query select g.id, pos;
end $$;

create or replace function app.adopt_candidate(p_media uuid, p_tenant uuid, p_member uuid, p_generation jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c record;
begin
  select * into c from app.require_adoptable_candidate(p_tenant, p_generation);
  insert into candidate_adoptions (post_media_id, generation_id, candidate_position, adopted_by)
  values (p_media, c.generation_id, c.candidate_position, p_member);
end $$;

-- ───────── 下書きの保存（TEMPLATE のスライド・素材画像の採用・追加のハッシュタグを記録） ─────────
create function app.save_template_slides(p_rev uuid, p_tenant uuid, p_member uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version text := p_data ->> 'templateVersion';
  v_style bigint;
  v_gen uuid := app.json_uuid_or_null(p_data, 'generationId');
  slides jsonb := p_data -> 'slides';
  tags jsonb := coalesce(p_data -> 'hashtags', '[]'::jsonb);
  n int; i int; k int; s jsonb; expected text; v_role text; v_slide uuid;
  v_bg uuid; v_desc text; em jsonb; v_start int; v_len int; mat jsonb; mat_path text; c record;
begin
  if v_version is null or not exists (select 1 from template_releases r where r.version = v_version) then
    raise exception 'テンプレートの版が正しくありません' using errcode = '22023';
  end if;
  select x.id into v_style from post_style_settings_current x where x.tenant_id = p_tenant;
  if v_style is null then
    raise exception '投稿の型の設定がありません。管理者が設定してください' using errcode = '22023';
  end if;
  insert into revision_templates (revision_id, template_version, style_settings_id) values (p_rev, v_version, v_style);

  if v_gen is not null then
    if not exists (select 1 from generations g where g.id = v_gen and g.tenant_id = p_tenant and g.outcome = 'SUCCEEDED') then
      raise exception '生成の参照が正しくありません' using errcode = '22023';
    end if;
    insert into revision_generations (revision_id, generation_id) values (p_rev, v_gen);
  end if;

  if jsonb_typeof(slides) is distinct from 'array' then
    raise exception 'スライドは配列で指定してください' using errcode = '22023';
  end if;
  n := jsonb_array_length(slides);
  if n < 3 or n > 10 then
    raise exception 'スライドは表紙1枚・中のスライド1〜8枚・最後のスライド1枚（3〜10枚）です' using errcode = '22023';
  end if;

  for i in 0 .. n - 1 loop
    s := slides -> i;
    if jsonb_typeof(s) is distinct from 'object' then
      raise exception 'スライドはオブジェクトで指定してください' using errcode = '22023';
    end if;
    expected := case when i = 0 then 'COVER' when i = n - 1 then 'CLOSING' else 'BODY' end;
    v_role := s ->> 'role';
    if v_role is distinct from expected then
      raise exception 'スライドの役割の並びが正しくありません（表紙 → 中のスライド → 最後のスライド）' using errcode = '22023';
    end if;
    insert into post_slides (revision_id, position, role) values (p_rev, i + 1, v_role) returning id into v_slide;

    if v_role = 'COVER' then
      if app.json_text(s, 'accent') not in ('PURPLE','RED','TEAL') then
        raise exception 'アクセント色が正しくありません' using errcode = '22023';
      end if;
      insert into cover_slides (slide_id, target, keyword, annotation, closing_words, accent)
      values (v_slide, app.json_text(s, 'target'), app.json_text(s, 'keyword'), app.json_text_or(s, 'annotation', ''),
              app.json_text(s, 'closingWords'), s ->> 'accent');
      v_bg := app.json_uuid_or_null(s, 'backgroundPhotoId');
      if v_bg is not null then
        if not exists (select 1 from background_photos b where b.id = v_bg and b.tenant_id = p_tenant) then
          raise exception '背景写真の参照が正しくありません' using errcode = '22023';
        end if;
        insert into cover_backgrounds (slide_id, background_photo_id) values (v_slide, v_bg);
      end if;

    elsif v_role = 'BODY' then
      v_desc := app.json_text(s, 'description');
      insert into body_slides (slide_id, heading, description, picture_prompt, needs_replacement)
      values (v_slide, app.json_text(s, 'heading'), v_desc, app.json_text(s, 'picturePrompt'),
              app.json_bool_or(s, 'needsReplacement', false));
      if s -> 'emphases' is not null and jsonb_typeof(s -> 'emphases') <> 'null' then
        if jsonb_typeof(s -> 'emphases') <> 'array' then
          raise exception '強調する語は配列で指定してください' using errcode = '22023';
        end if;
        k := 0;
        for em in select * from jsonb_array_elements(s -> 'emphases') loop
          k := k + 1;
          if jsonb_typeof(em) <> 'object' then
            raise exception '強調する語はオブジェクトで指定してください' using errcode = '22023';
          end if;
          v_start := app.json_int(em, 'start');
          v_len := app.json_int(em, 'length');
          -- 範囲が説明文（コードポイント）に収まること。重なり・個数はドメインが検査する
          if v_start < 0 or v_len < 1 or v_start + v_len > char_length(v_desc) then
            raise exception '強調する語の範囲が説明文に収まっていません' using errcode = '22023';
          end if;
          insert into body_emphases (slide_id, seq, start_cp, length_cp) values (v_slide, k, v_start, v_len);
        end loop;
      end if;
      mat := s -> 'material';
      if mat is not null and jsonb_typeof(mat) <> 'null' then
        if jsonb_typeof(mat) <> 'object' then
          raise exception '素材画像はオブジェクトで指定してください' using errcode = '22023';
        end if;
        mat_path := app.json_text(mat, 'storagePath');
        -- {団体}/posts/{ファイル名}.jpg の形だけ（../ などで別の場所を指させない）
        if mat_path !~ ('^' || p_tenant::text || '/posts/[A-Za-z0-9_-]+\.jpg$') then
          raise exception '素材画像の保存先が正しくありません' using errcode = '42501';
        end if;
        insert into body_materials (slide_id, storage_path, width, height, byte_size)
        values (v_slide, mat_path, app.json_int(mat, 'width'), app.json_int(mat, 'height'), app.json_int(mat, 'byteSize'));
        if jsonb_typeof(mat -> 'generation') = 'object' then
          select * into c from app.require_adoptable_candidate(p_tenant, mat -> 'generation');
          insert into material_adoptions (slide_id, generation_id, candidate_position, adopted_by)
          values (v_slide, c.generation_id, c.candidate_position, p_member);
        end if;
      end if;
    end if;
  end loop;

  if jsonb_typeof(tags) is distinct from 'array' then
    raise exception 'ハッシュタグは配列で指定してください' using errcode = '22023';
  end if;
  k := 0;
  for s in select * from jsonb_array_elements(tags) loop
    if jsonb_typeof(s) <> 'string' then
      raise exception 'ハッシュタグは文字列で指定してください' using errcode = '22023';
    end if;
    k := k + 1;
    insert into revision_hashtags (revision_id, position, hashtag) values (p_rev, k, s #>> '{}');
  end loop;
end $$;

-- p_revision（UPLOAD は V8 と同じ）:
--   {format, mediaSource, caption, prCategory, genreId?, media:[{position, storagePath, width, height, byteSize, generation?}]}
-- p_revision（TEMPLATE。設計 4章）:
--   {format:'CAROUSEL', mediaSource:'TEMPLATE', caption, prCategory, genreId?, templateVersion, generationId?, hashtags:[...],
--    slides:[{role:'COVER', target, keyword, annotation, closingWords, accent, backgroundPhotoId?},
--            {role:'BODY', heading, description, emphases:[{start, length}], picturePrompt, needsReplacement,
--             material?:{storagePath, width, height, byteSize, generation?:{generationId, candidatePosition}}},
--            {role:'CLOSING'}]}
create or replace function public.save_post_revision(p_post uuid, p_revision jsonb) returns table (post_id uuid, revision_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_post uuid := p_post; rev uuid; next_no int; item jsonb; media_id uuid; is_template boolean;
begin
  select * into me from app.require_member();
  is_template := (p_revision ->> 'mediaSource') = 'TEMPLATE';
  if is_template then
    if (p_revision ->> 'format') is distinct from 'CAROUSEL' then
      raise exception 'テンプレートの投稿はカルーセルです' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(p_revision -> 'media', '[]'::jsonb)) <> 0 then
      raise exception 'テンプレートの投稿に投稿画像は付けられません' using errcode = '22023';
    end if;
  end if;
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
  if is_template then
    perform app.save_template_slides(rev, me.tenant_id, me.member_id, p_revision);
  else
    for item in select * from jsonb_array_elements(coalesce(p_revision -> 'media', '[]'::jsonb)) loop
      -- {団体}/posts/{ファイル名}.jpg の形だけ（../ などで別の場所を指させない）
      if (item ->> 'storagePath') !~ ('^' || me.tenant_id::text || '/posts/[A-Za-z0-9_-]+\.jpg$') then
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
  end if;
  if next_no = 1 then
    insert into post_events (post_id, event_type, from_status, to_status, revision_id, actor_member_id)
    values (v_post, 'CREATED', 'NEW', 'DRAFT', rev, me.member_id);
  end if;
  return query select v_post, rev;
end $$;

-- ───────── 承認（TEMPLATE の版は、承認の出来事に過去の投稿を結び付けて記録する） ─────────
-- 過去の投稿の表紙の保存先: UPLOAD は承認した版の post_media の1枚目、TEMPLATE は最新の承認の出来事の template_renders の1枚目
create function app.past_post_cover(p_post uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case r.media_source
           when 'UPLOAD' then (select pm.storage_path from post_media pm where pm.revision_id = a.revision_id and pm.position = 1)
           else (select tr.storage_path from template_renders tr where tr.approval_event_id = a.id and tr.position = 1)
         end
    from (select e.id, e.revision_id from post_events e
           where e.post_id = p_post and e.event_type = 'APPROVED' order by e.id desc limit 1) a
    join post_revisions r on r.id = a.revision_id
$$;

create or replace function public.approve_post(p_post uuid, p_revision uuid, p_scheduled_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; requested uuid; ev bigint; v_source text;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  perform app.lock_own_post(p_post, me.tenant_id);
  select revision_id into requested from post_events
   where post_id = p_post and event_type = 'APPROVAL_REQUESTED' order by id desc limit 1;
  if requested is distinct from p_revision then
    raise exception '承認を依頼された版ではありません。画面を更新してください' using errcode = 'P0409';
  end if;
  insert into post_events (post_id, event_type, from_status, to_status, revision_id, actor_member_id)
  values (p_post, 'APPROVED', 'AWAITING_APPROVAL', 'SCHEDULED', p_revision, me.member_id) returning id into ev;
  insert into post_schedules (post_id, event_id, scheduled_at, decided_by) values (p_post, ev, p_scheduled_at, me.member_id);
  select r.media_source into v_source from post_revisions r where r.id = p_revision;
  if v_source = 'TEMPLATE' then
    -- その投稿自身を除き、承認した時点で公開済みの投稿のうち公開日時が新しい2件（0件なら行を作らない）
    insert into approval_past_posts (approval_event_id, position, past_post_id, cover_storage_path)
    select ev, (row_number() over (order by c.published_at desc, c.post_id))::int, c.post_id, c.cover
      from (select pub.post_id, pub.published_at, app.past_post_cover(pub.post_id) as cover
              from post_publications pub join posts pp on pp.id = pub.post_id
             where pp.tenant_id = me.tenant_id and pub.post_id <> p_post) c
     where c.cover is not null
     order by c.published_at desc, c.post_id
     limit 2;
  end if;
end $$;

-- ───────── RPC: 管理者 ─────────
create function public.register_background_photo(p_storage_path text, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_id uuid;
begin
  select * into me from app.require_role(array['ADMIN']);
  if p_storage_path is null or p_storage_path !~ ('^' || me.tenant_id::text || '/backgrounds/[A-Za-z0-9_-]+\.jpg$') then
    raise exception '背景写真の保存先が正しくありません' using errcode = '42501';
  end if;
  if p_description is null or char_length(p_description) not between 1 and 100 then
    raise exception '説明文は1〜100文字で入力してください' using errcode = '22023';
  end if;
  perform 1 from tenants where id = me.tenant_id for update;         -- 同時登録でも30枚を超えないよう直列化する
  if (select count(*) from usable_background_photos u where u.tenant_id = me.tenant_id) >= 30 then
    raise exception '背景写真は使う写真を30枚までです。使わない写真を増やしてから足してください' using errcode = '22023';
  end if;
  insert into background_photos (tenant_id, storage_path, description, registered_by)
  values (me.tenant_id, p_storage_path, p_description, me.member_id) returning id into v_id;
  return v_id;
end $$;

-- 写真は消さず「使わない」にした出来事を追記する（既存の投稿の画像化には使える）。すでに使わないなら何もしない
create function public.retire_background_photo(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from app.require_role(array['ADMIN']);
  if not exists (select 1 from background_photos b where b.id = p_id and b.tenant_id = me.tenant_id) then
    raise exception '背景写真が見つかりません' using errcode = 'P0404';
  end if;
  insert into background_photo_retirements (background_photo_id, retired_by) values (p_id, me.member_id)
  on conflict (background_photo_id) do nothing;
end $$;

-- 新しい版を作る（版は変更しない）。戻り値は新しい版番号
create function public.save_post_style_settings(
  p_band_text text, p_cover_targets text[], p_closing_message text, p_account_introduction text,
  p_caption_footer text, p_fixed_hashtags text[], p_logo_storage_path text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_version int; v_id bigint;
begin
  select * into me from app.require_role(array['ADMIN']);
  if p_band_text is null or p_closing_message is null or p_account_introduction is null or p_fixed_hashtags is null
     or p_cover_targets is null or coalesce(cardinality(p_cover_targets), 0) < 1
     or p_caption_footer is null or char_length(p_caption_footer) < 1 then
    raise exception '投稿の型の設定に足りない項目があります' using errcode = '22023';
  end if;
  if p_logo_storage_path is not null and p_logo_storage_path !~ ('^' || me.tenant_id::text || '/style/[A-Za-z0-9_-]+\.png$') then
    raise exception 'ロゴの保存先が正しくありません' using errcode = '42501';
  end if;
  perform 1 from tenants where id = me.tenant_id for update;
  select coalesce(max(s.version), 0) + 1 into v_version from post_style_settings s where s.tenant_id = me.tenant_id;
  insert into post_style_settings (tenant_id, version, band_text, cover_targets, closing_message, account_introduction,
                                   caption_footer, fixed_hashtags, created_by)
  values (me.tenant_id, v_version, p_band_text, p_cover_targets, p_closing_message, p_account_introduction,
          p_caption_footer, p_fixed_hashtags, me.member_id) returning id into v_id;
  if p_logo_storage_path is not null then
    insert into post_style_logos (style_settings_id, storage_path) values (v_id, p_logo_storage_path);
  end if;
  return v_version;
end $$;

-- 新しい版を作る（有効にはしない。activate_prompt_version で有効にする）
create function public.create_prompt_version(p_purpose text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_no int; v_id uuid;
begin
  select * into me from app.require_role(array['ADMIN']);
  if p_purpose is null or p_purpose not in ('PLAN','CAPTION','REVISE') then
    raise exception 'プロンプトの用途が正しくありません' using errcode = '22023';
  end if;
  if p_body is null or char_length(p_body) < 1 then
    raise exception 'プロンプトの本文を入力してください' using errcode = '22023';
  end if;
  perform 1 from tenants where id = me.tenant_id for update;
  select coalesce(max(v.version_no), 0) + 1 into v_no from prompt_versions v
   where v.tenant_id = me.tenant_id and v.purpose = p_purpose;
  insert into prompt_versions (tenant_id, purpose, version_no, body, created_by)
  values (me.tenant_id, p_purpose, v_no, p_body, me.member_id) returning id into v_id;
  return v_id;
end $$;

-- 有効にする（同じ用途の前の有効な版は、有効化の履歴に残るだけで無効になる）。すでに有効なら何もしない
create function public.activate_prompt_version(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v record;
begin
  select * into me from app.require_role(array['ADMIN']);
  select * into v from prompt_versions x where x.id = p_id and x.tenant_id = me.tenant_id;
  if v.id is null then
    raise exception 'プロンプト版が見つかりません' using errcode = 'P0404';
  end if;
  perform 1 from tenants where id = me.tenant_id for update;
  if exists (select 1 from active_prompt_versions a
              where a.tenant_id = me.tenant_id and a.purpose = v.purpose and a.prompt_version_id = p_id) then
    return;
  end if;
  insert into prompt_activations (prompt_version_id, activated_by) values (p_id, me.member_id);
end $$;

-- ───────── RPC: API関数・定期処理（service role） ─────────
create function public.record_idea(p_id uuid, p_tenant uuid, p_member uuid, p_body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from members m where m.id = p_member and m.tenant_id = p_tenant) then
    raise exception 'メンバーが見つかりません' using errcode = '22023';
  end if;
  insert into ideas (id, tenant_id, source, body, created_by) values (p_id, p_tenant, 'MEMO', p_body, p_member);
end $$;

-- 生成の依頼1回を、LLM 呼び出し（p_attempts の並びが1回目・2回目）・成功した下書き案・修正指示とまとめて記録する
-- p_attempts: [{model, rawOutput, violations:[...]}]（手動コピペは空）／p_result: 成功したときの下書き案（それ以外は null）
-- p_parent・p_instruction: 修正指示のときだけ（両方を付けるか、両方 null）
create function public.record_generation(
  p_id uuid, p_tenant uuid, p_member uuid, p_purpose text, p_route text, p_idea uuid, p_prompt_version uuid,
  p_input jsonb, p_outcome text, p_attempts jsonb, p_result jsonb, p_parent uuid, p_instruction text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; n int := 0; attempts jsonb := coalesce(p_attempts, '[]'::jsonb);
begin
  if not exists (select 1 from members m where m.id = p_member and m.tenant_id = p_tenant)
     or not exists (select 1 from ideas i where i.id = p_idea and i.tenant_id = p_tenant)
     or not exists (select 1 from prompt_versions v
                     where v.id = p_prompt_version and v.tenant_id = p_tenant and v.purpose = p_purpose) then
    raise exception '生成の参照が正しくありません' using errcode = '22023';
  end if;
  if (p_outcome = 'SUCCEEDED') <> coalesce(jsonb_typeof(p_result) = 'object', false) then
    raise exception '生成の結果と下書き案が合っていません' using errcode = '22023';
  end if;
  if jsonb_typeof(attempts) <> 'array' or (p_route = 'MANUAL' and jsonb_array_length(attempts) <> 0) then
    raise exception 'LLM 呼び出しの記録が正しくありません' using errcode = '22023';
  end if;
  if (p_parent is null) <> (p_instruction is null) then
    raise exception '修正指示は親の生成と一緒に指定してください' using errcode = '22023';
  end if;
  if p_parent is not null and not exists (select 1 from generations g where g.id = p_parent and g.tenant_id = p_tenant) then
    raise exception '親の生成が見つかりません' using errcode = '22023';
  end if;
  insert into generations (id, tenant_id, requested_by, purpose, route, idea_id, prompt_version_id, input, outcome)
  values (p_id, p_tenant, p_member, p_purpose, p_route, p_idea, p_prompt_version, p_input, p_outcome);
  for a in select * from jsonb_array_elements(attempts) loop
    n := n + 1;
    insert into generation_attempts (generation_id, attempt_no, model, raw_output, violations)
    values (p_id, n, app.json_text(a, 'model'), app.json_text_or(a, 'rawOutput', ''), coalesce(a -> 'violations', '[]'::jsonb));
  end loop;
  if p_outcome = 'SUCCEEDED' then
    insert into generation_results (generation_id, proposal) values (p_id, p_result);
  end if;
  if p_parent is not null then
    insert into generation_revisions (generation_id, parent_generation_id, instruction) values (p_id, p_parent, p_instruction);
  end if;
end $$;

-- 画像化した JPEG の記録（承認の出来事ごと。保存先は {団体}/renders/{承認の出来事}/{順番}.jpg に限る）
create function public.record_template_render(
  p_approval_event bigint, p_position int, p_storage_path text, p_width int, p_height int, p_byte_size int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid;
begin
  select p.tenant_id into t from post_events e join posts p on p.id = e.post_id
   where e.id = p_approval_event and e.event_type = 'APPROVED';
  if t is null then
    raise exception '承認の出来事が見つかりません' using errcode = 'P0404';
  end if;
  if p_storage_path is distinct from t::text || '/renders/' || p_approval_event::text || '/' || p_position::text || '.jpg' then
    raise exception '画像化した画像の保存先が正しくありません' using errcode = '22023';
  end if;
  insert into template_renders (approval_event_id, position, storage_path, width, height, byte_size)
  values (p_approval_event, p_position, p_storage_path, p_width, p_height, p_byte_size);
end $$;

-- TEMPLATE の版の公開用 JPEG の記録（承認の出来事ごと。media-public の {団体}/{ファイル名}.jpg）
create function public.record_template_publish_media(
  p_revision uuid, p_approval_event bigint, p_position int, p_storage_path text,
  p_width int, p_height int, p_byte_size int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t uuid;
begin
  select p.tenant_id into t from post_events e
    join posts p on p.id = e.post_id
    join post_revisions r on r.id = e.revision_id and r.media_source = 'TEMPLATE'
   where e.id = p_approval_event and e.event_type = 'APPROVED' and e.revision_id = p_revision;
  if t is null then
    raise exception '承認の出来事が見つかりません' using errcode = 'P0404';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || t::text || '/[A-Za-z0-9_-]+\.jpg$') then
    raise exception '公開用画像の保存先が正しくありません' using errcode = '22023';
  end if;
  insert into template_publish_media (revision_id, approval_event_id, position, storage_path, width, height, byte_size)
  values (p_revision, p_approval_event, p_position, p_storage_path, p_width, p_height, p_byte_size);
end $$;

-- ───────── プロンプトの初版（PLAN・REVISE）。本文は書き方の指示だけで、団体の文面を含まない ─────────
-- 差し込む値は {{ideaText}} のような単純な形（生成の入力から API関数が置き換える）
create function app.initial_prompt_body(p_purpose text) returns text
language sql immutable as $fn$
  select case p_purpose
    when 'PLAN' then $plan$あなたは大学生向けSNSメディアの Instagram 投稿を作る担当です。次の「ネタ」から、カルーセル投稿の文言とキャプションを作り、指定した JSON だけを出力してください。説明文やコードブロックの記号は付けません。

# ネタ（箇条書きの情報。今日の日付: {{today}}）
{{ideaText}}

# 書き方の指示
- ネタに無い事実を書かないこと。日時・場所・料金・URL・固有名詞は、ネタに書かれているものだけを使い、推測で補わない。
- 投稿は、表紙1枚・中のスライド1〜8枚・最後のスライド1枚で作る。中のスライドの枚数は、ネタの内容に合わせて決める。最後のスライドは自動で作るので、出力に含めない。
- 表紙は3段。target は次の候補から1つ選ぶ: {{coverTargets}}。keyword は1〜10文字。annotation は0〜16文字（無ければ空文字）。closingWords は1〜8文字（例: まとめたよ、紹介します）。accent は次から話題に合うものを1つ選ぶ: {{accentColors}}。
- 表紙の背景写真は、次の候補の説明文から話題に合うものを1つ選び、その ID を backgroundPhotoId に入れる。合うものが無い、または候補が無いときは backgroundPhotoId を空文字にする。
{{backgroundPhotos}}
- 中のスライドは、heading（1〜16文字）と description（1〜120文字）で作る。description の中で目立たせたい語を、description に含まれる語そのままで0〜3か所、emphases に入れる。強調する語どうしは重ならないようにする。
- 文字数は絵文字も1文字と数える。
- pictureBrief は、そのスライドのカードに載せる素材画像を作るための短い説明を日本語で書く。絵の指示に固有名詞・商標・実在の人物を入れない。一般的な物や場面の言葉に言い換える（例: 特定のアプリ名ではなく「スマートフォンの画面」）。
- 実在のロゴ・料金表・アプリの画面・実在の施設の写真など、実物が要るスライドには、needsReplacement を true にして差し替えが必要の印を付ける。それ以外は false にする。
- caption は2〜3段落で、読みやすく簡潔に書く。絵文字を使ってよい。ハッシュタグ・区切り線・運営の紹介は自動で付くので書かない。
- additionalHashtags は、話題に合うハッシュタグを # 付きで0〜5個。固定のハッシュタグは自動で付くので入れない。
- prCategory は、ネタが広告・提携の依頼でなければ NONE、そうであれば PR。
- sourceUrls は、ネタに参照元の URL があるときだけ入れ、無ければ空の配列にする。ネタに無い URL を作らない。

# 出力 JSON の形
{
  "cover": { "target": "", "keyword": "", "annotation": "", "closingWords": "", "accent": "PURPLE | RED | TEAL" },
  "backgroundPhotoId": "",
  "slides": [ { "heading": "", "description": "", "emphases": [""], "pictureBrief": "", "needsReplacement": false } ],
  "caption": "",
  "additionalHashtags": [""],
  "prCategory": "NONE | PR",
  "sourceUrls": [""]
}
$plan$
    when 'REVISE' then $revise$あなたは大学生向けSNSメディアの Instagram 投稿を作る担当です。次の「現在の下書き」を、「修正指示」に沿って直し、指定した JSON だけを出力してください。説明文やコードブロックの記号は付けません。

# ネタ（箇条書きの情報。今日の日付: {{today}}）
{{ideaText}}

# 現在の下書き
{{currentDraft}}

# 修正指示
{{instruction}}

# 書き方の指示
- 直すのは文言だけ。中のスライドの枚数は必ず {{bodySlideCount}} 枚のままにし、並びも変えない。
- ネタに無い事実を書かないこと。日時・場所・料金・URL・固有名詞は、ネタに書かれているものだけを使い、推測で補わない。
- 表紙の target は次の候補から1つ選ぶ: {{coverTargets}}。keyword は1〜10文字。annotation は0〜16文字（無ければ空文字）。closingWords は1〜8文字。accent は次から選ぶ: {{accentColors}}。
- 背景写真は修正では変えない。backgroundPhotoId は空文字にする。
- 中のスライドは、heading（1〜16文字）と description（1〜120文字）で作る。description の中で目立たせたい語を、description に含まれる語そのままで0〜3か所、emphases に入れる。強調する語どうしは重ならないようにする。
- 文字数は絵文字も1文字と数える。
- pictureBrief は、そのスライドのカードに載せる素材画像を作るための短い説明を日本語で書く。絵の指示に固有名詞・商標・実在の人物を入れない。一般的な物や場面の言葉に言い換える。
- 実在のロゴ・料金表・アプリの画面・実在の施設の写真など、実物が要るスライドには、needsReplacement を true にして差し替えが必要の印を付ける。それ以外は false にする。
- caption は2〜3段落で、読みやすく簡潔に書く。絵文字を使ってよい。ハッシュタグ・区切り線・運営の紹介は自動で付くので書かない。
- additionalHashtags は、話題に合うハッシュタグを # 付きで0〜5個。固定のハッシュタグは自動で付くので入れない。
- prCategory は、現在の下書きから変えない。
- sourceUrls は、現在の下書きから変えない。ネタに無い URL を作らない。

# 出力 JSON の形
{
  "cover": { "target": "", "keyword": "", "annotation": "", "closingWords": "", "accent": "PURPLE | RED | TEAL" },
  "backgroundPhotoId": "",
  "slides": [ { "heading": "", "description": "", "emphases": [""], "pictureBrief": "", "needsReplacement": false } ],
  "caption": "",
  "additionalHashtags": [""],
  "prCategory": "NONE | PR",
  "sourceUrls": [""]
}
$revise$
  end
$fn$;

-- 団体にプロンプトの初版を入れて有効にする（その用途の版がまだ無いときだけ。scripts/seed_tenant.sql も使う）
create function app.seed_initial_prompts(p_tenant uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p text; v uuid;
begin
  foreach p in array array['PLAN','REVISE'] loop
    if not exists (select 1 from prompt_versions x where x.tenant_id = p_tenant and x.purpose = p) then
      insert into prompt_versions (tenant_id, purpose, version_no, body) values (p_tenant, p, 1, app.initial_prompt_body(p))
      returning id into v;
      insert into prompt_activations (prompt_version_id) values (v);
    end if;
  end loop;
end $$;

select app.seed_initial_prompts(t.id) from tenants t;

-- ───────── 権限 ─────────
revoke execute on function
  app.can_read_generation(uuid), app.can_read_prompt_version(uuid), app.can_read_style_settings(bigint),
  app.can_read_background_photo(uuid), app.can_read_slide(uuid), app.can_read_approval_event(bigint),
  app.json_text(jsonb, text), app.json_text_or(jsonb, text, text), app.json_int(jsonb, text),
  app.json_bool_or(jsonb, text, boolean), app.json_uuid_or_null(jsonb, text),
  app.require_adoptable_candidate(uuid, jsonb), app.save_template_slides(uuid, uuid, uuid, jsonb),
  app.past_post_cover(uuid), app.initial_prompt_body(text), app.seed_initial_prompts(uuid) from public;
grant execute on function
  app.can_read_generation(uuid), app.can_read_prompt_version(uuid), app.can_read_style_settings(bigint),
  app.can_read_background_photo(uuid), app.can_read_slide(uuid), app.can_read_approval_event(bigint) to authenticated;

revoke execute on function
  public.register_background_photo(text, text), public.retire_background_photo(uuid),
  public.save_post_style_settings(text, text[], text, text, text, text[], text),
  public.create_prompt_version(text, text), public.activate_prompt_version(uuid) from public, anon;
grant execute on function
  public.register_background_photo(text, text), public.retire_background_photo(uuid),
  public.save_post_style_settings(text, text[], text, text, text, text[], text),
  public.create_prompt_version(text, text), public.activate_prompt_version(uuid) to authenticated;

revoke execute on function
  public.record_idea(uuid, uuid, uuid, text),
  public.record_generation(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, jsonb, uuid, text),
  public.record_template_render(bigint, int, text, int, int, int),
  public.record_template_publish_media(uuid, bigint, int, text, int, int, int) from public, anon, authenticated;
grant execute on function
  public.record_idea(uuid, uuid, uuid, text),
  public.record_generation(uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text, jsonb, jsonb, uuid, text),
  public.record_template_render(bigint, int, text, int, int, int),
  public.record_template_publish_media(uuid, bigint, int, text, int, int, int) to service_role;

-- ───────── Storage: 背景写真（backgrounds/）とロゴ（style/）は管理者だけが書ける。renders/ は service role だけ ─────────
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage スキーマが無いため、ポリシーを作りません（Supabase 以外の DB）';
    return;
  end if;
  create policy uploads_private_insert_admin on storage.objects for insert to authenticated
    with check (bucket_id = 'uploads-private'
                and (storage.foldername(name))[2] in ('backgrounds', 'style')
                and exists (select 1 from app.current_member() cm
                             where cm.tenant_id::text = (storage.foldername(name))[1] and cm.role = 'ADMIN'));
end $$;
