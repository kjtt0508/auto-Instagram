-- 表紙の背景を AI で作る・帯の色を7色にする（REQ-006 設計 2・4・5章、ADR-0005）
-- V10 は本番に適用済みなので変えない。この V11 は表・列・制約・関数の追加と付け替えだけ（戻すときも前の画面・Java から読み書きできる）。
-- DB の検査は「形」と団体の境界だけ。画像の種類・30枚などの判断は RPC とドメインが持つ（30枚は同時実行のため RPC でも検査する）。

-- ───────── アクセント色（帯の色）7色: DB の置き場所は1つ ─────────
-- 色を足すときは、この関数だけを直す（TS・Java・docs/model/fixtures/accent-colors.json と合わせる）。
-- 検査だけの純粋な関数なので、実行権限は変えない（CHECK は書き込む側のロールで評価されるため）
create function app.is_accent_code(p_code text) returns boolean
language sql immutable as $$
  select coalesce(p_code in ('PURPLE','RED','TEAL','BLUE','GREEN','ORANGE','PINK'), false)
$$;

-- cover_slides.accent の CHECK を、V10 の自動名（cover_slides_accent_check）のまま付け直す（post_failures の前例と同じ書き方）
alter table cover_slides drop constraint cover_slides_accent_check;
alter table cover_slides add constraint cover_slides_accent_check check (app.is_accent_code(accent));

-- ───────── 背景写真の説明文の形: DB の置き場所は1つ ─────────
-- 説明文に入れられない文字: 改行を含む制御文字（Cc）と、行の区切り U+2028・段落の区切り U+2029（AI に渡す写真の一覧が1行1枚で並ぶため）。
-- TS の BackgroundPhoto.violationsOfDescription と同じ範囲。文字数（1〜100）は含めない（長さの数え方は trim 後で、RPC が検査する）。
-- 区切り文字は、ソースに直接書くと保存で本物の改行に変換されるので chr(8232)・chr(8233) で書く
create function app.is_background_description(p_text text) returns boolean
language sql immutable as $$
  select p_text is not null and p_text !~ ('[\u0001-\u001f\u007f-\u009f' || chr(8232) || chr(8233) || ']')
$$;

-- 既存の行は検査しない（not valid）。本番にすでに登録された説明文に制御文字があっても migrate は失敗せず、新しく書く行だけが検査される
alter table background_photos add constraint background_photos_description_form
  check (app.is_background_description(description)) not valid;

-- ───────── 下書きの保存（V10 の本文の複写。変えたのはアクセントの検査の1か所だけ） ─────────
-- 以降は、色を足しても app.is_accent_code だけを直す（この複写はこれが最後）
create or replace function app.save_template_slides(p_rev uuid, p_tenant uuid, p_member uuid, p_data jsonb) returns void
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
      if not app.is_accent_code(app.json_text(s, 'accent')) then
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

-- ───────── 背景写真としての採用（追記のみ） ─────────
-- 背景写真の出どころ（管理者の登録／AI が作った背景）は列に持たず、この記録があるかどうかから導く（P31）。
-- 同じ候補を二重に背景写真にしない（unique）。画像生成との外部キーは candidate_adoptions・material_adoptions と同じ
create table background_photo_adoptions (
  background_photo_id  uuid primary key references background_photos(id),
  generation_id        uuid not null references image_generations(id),
  candidate_position   int  not null check (candidate_position between 1 and 4),
  adopted_by           uuid not null references members(id),
  adopted_at           timestamptz not null default now(),
  unique (generation_id, candidate_position)
);

-- 追記のみ（V10 と同じ仕組み）
do $$
declare t text;
begin
  foreach t in array array['background_photo_adoptions']
  loop
    execute format('create trigger %I before update or delete on %I for each row execute function app.forbid_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- 使っている背景写真のビュー: 出どころを導く列（generated＝採用の記録があるか）を足す。列の並びは変えない（p.* の後ろに足すだけ）
create or replace view usable_background_photos with (security_invoker = true) as
select p.*, exists (select 1 from background_photo_adoptions a where a.background_photo_id = p.id) as generated
  from background_photos p
 where not exists (select 1 from background_photo_retirements r where r.background_photo_id = p.id);

-- ───────── RLS: 背景写真の団体で判定して、同団体のメンバーが読める（書くポリシーは付けない） ─────────
do $$
declare t text;
begin
  foreach t in array array['background_photo_adoptions']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy background_photo_adoptions_read on background_photo_adoptions for select to authenticated
  using (app.can_read_background_photo(background_photo_id));

do $$
declare t text;
begin
  foreach t in array array['background_photo_adoptions']
  loop
    execute format('revoke all on %I from anon', t);
    execute format('revoke insert, update, delete, truncate on %I from authenticated', t);
  end loop;
end $$;

-- ───────── RPC: 生成した背景を背景写真として記録する（API関数が候補の画像を複製してから呼ぶ。service role だけ） ─────────
-- 順番（設計 4章）: 団体の行を for no key update で直列化 → そのあとで二重採用を調べる（当たったら既存の背景写真IDを返す。
-- unique に当たる前に調べる）→ 使う背景写真が30枚未満か（register_background_photo と同じ。NFR-006-04）
-- → 採用できる候補か（app.require_adoptable_candidate と同じ条件）・画像の種類が ILLUSTRATION か → 説明文の形 → 保存先の形
-- → background_photos と background_photo_adoptions を1つのトランザクションで追記する。
-- エラー（SQLSTATE で判別できる。API関数は文言ではなくこれで分岐する）:
--   P0409＝背景写真がすでに30枚（「競合」の意味。V5・V6・V10 と同じ）／P0404＝団体・メンバーが無い（無効化されたメンバーも「無い」）／
--   42501＝保存先の形（register_background_photo と同じ）／22023＝ほかの拒否（採用できない候補・写真風・説明文の形・保存先の重複・使わない背景の再採用）
-- 説明文: 改行・制御文字を拒否してから、前後の空白を取り除いて1〜100文字を検査し、取り除いた値を保存する（TS の BackgroundPhoto.violationsOfDescription と同じ）
create function public.record_generated_background(
  p_tenant uuid, p_member uuid, p_storage_path text, p_generation uuid, p_position int, p_description text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; c record; v_style text; v_description text;
  -- JavaScript の trim が取り除く空白のうち、制御文字・U+2028/2029 を除いたもの（それらは先に拒否される）
  v_blank constant text := '[    -   　﻿]';
begin
  perform 1 from tenants where id = p_tenant for no key update;  -- 同時登録でも30枚を超えないよう直列化する（register_background_photo と同じ）
  if not found then
    raise exception '団体が見つかりません' using errcode = 'P0404';
  end if;
  -- 無効化されたメンバーは「いない」のと同じ（app.current_member と同じく member_current の active で判定）
  if not exists (select 1 from member_current mc where mc.member_id = p_member and mc.tenant_id = p_tenant and mc.active) then
    raise exception 'メンバーが見つかりません' using errcode = 'P0404';
  end if;

  -- 二重採用: すでに背景写真になっている候補は、新しく作らず既存の背景写真IDを返す（他団体の写真は返さない）。
  -- ただし「使わない」になっている背景は返さない（使わない写真を表紙にできないように）
  select a.background_photo_id into v_id
    from background_photo_adoptions a join background_photos b on b.id = a.background_photo_id
   where a.generation_id = p_generation and a.candidate_position = p_position and b.tenant_id = p_tenant;
  if found then
    if exists (select 1 from background_photo_retirements r where r.background_photo_id = v_id) then
      raise exception 'この背景は使わない設定になっています' using errcode = '22023';
    end if;
    return v_id;
  end if;

  if (select count(*) from usable_background_photos u where u.tenant_id = p_tenant) >= 30 then
    raise exception '背景写真は使う写真を30枚までです。使わない写真を増やしてから足してください' using errcode = 'P0409';
  end if;

  select * into c from app.require_adoptable_candidate(p_tenant,
    jsonb_build_object('generationId', p_generation, 'candidatePosition', p_position));
  select g.style into v_style from image_generations g where g.id = c.generation_id;
  if v_style is distinct from 'ILLUSTRATION' then
    raise exception '背景写真にできるのは背景・イラストの画像だけです（写真風の画像は使えません）' using errcode = '22023';
  end if;

  if p_description is null then
    raise exception '説明文は1〜100文字で入力してください' using errcode = '22023';
  end if;
  if not app.is_background_description(p_description) then
    raise exception '説明文に改行や制御文字は入れられません' using errcode = '22023';
  end if;
  v_description := regexp_replace(p_description, '^' || v_blank || '+|' || v_blank || '+$', '', 'g');
  if char_length(v_description) not between 1 and 100 then
    raise exception '説明文は1〜100文字で入力してください' using errcode = '22023';
  end if;

  if p_storage_path is null or p_storage_path !~ ('^' || p_tenant::text || '/backgrounds/[A-Za-z0-9_-]+\.jpg$') then
    raise exception '背景写真の保存先が正しくありません' using errcode = '42501';
  end if;

  begin
    insert into background_photos (tenant_id, storage_path, description, registered_by)
    values (p_tenant, p_storage_path, v_description, p_member) returning id into v_id;
  exception when unique_violation then
    raise exception 'その保存先はすでに背景写真として使われています' using errcode = '22023';
  end;
  insert into background_photo_adoptions (background_photo_id, generation_id, candidate_position, adopted_by)
  values (v_id, c.generation_id, c.candidate_position, p_member);
  return v_id;
end $$;

-- ───────── 権限 ─────────
revoke execute on function public.record_generated_background(uuid, uuid, text, uuid, int, text) from public, anon, authenticated;
grant execute on function public.record_generated_background(uuid, uuid, text, uuid, int, text) to service_role;
