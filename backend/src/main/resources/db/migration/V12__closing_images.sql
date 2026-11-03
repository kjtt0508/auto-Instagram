-- 最後のスライドの画像を設定画面でアップロードする（REQ-007 設計 4・5章、ADR-0005）
-- V10・V11 は本番に適用済みなので変えない。この V12 は表の追加と関数の付け替えだけ（追記型）。
-- DB の検査は「形」と団体の境界だけ。画像の画素数（400×500px 以上など）は画面で確かめる（サーバーは保存先・枚数・重複を検査する）。
-- 既存の設定の版には画像の行を作らない（「記録0件なら設定の画像」で改修前の承認が画像なしになるのは、この約束による。BR-007-05）。
-- approval_past_posts の行はそのまま残す（REQ-007 より前の承認を記録のまま画像化するため。新しくは作らない）。

-- ───────── 1. 設定の版ごとの最後のスライドの画像（1行＝1枚。画像が0枚の版は行が無い。ロゴの post_style_logos と同じ） ─────────
create table post_style_closing_images (
  style_settings_id  bigint not null references post_style_settings(id),
  position           int    not null check (position between 1 and 2),   -- 1枚目が左。上限2は ClosingContent.MAX_IMAGES（niijima@1 の枠の数）
  storage_path       text   not null check (char_length(storage_path) >= 1),
  primary key (style_settings_id, position),
  unique (style_settings_id, storage_path)
);

-- 追記のみ（V10 と同じ仕組み）
create trigger post_style_closing_images_append_only before update or delete on post_style_closing_images
  for each row execute function app.forbid_mutation();

-- RLS: 設定の版の団体で判定して、同団体のメンバーが読める（書くポリシーは付けない。書くのは save_post_style_settings だけ）
alter table post_style_closing_images enable row level security;

create policy post_style_closing_images_read on post_style_closing_images for select to authenticated
  using (app.can_read_style_settings(style_settings_id));

-- 画面のロールの書き込み権限も外す
revoke all on post_style_closing_images from anon;
revoke insert, update, delete, truncate on post_style_closing_images from authenticated;

-- ───────── 2. 設定の保存: 引数に p_closing_images を足す ─────────
-- default 付きの引数を足すと別の関数として共存し、PostgREST が呼び分けに迷うので、古い署名を消してから新しい署名で作る。
-- 古い画面が名前付きで呼んでも p_closing_images は default で受ける（画像0枚の版になる）
drop function public.save_post_style_settings(text, text[], text, text, text, text[], text);

-- 新しい版を作る（版は変更しない）。戻り値は新しい版番号。
-- p_closing_images は並べる順の保存先（添字が順になる）。
-- エラー: 42501＝管理者でない／ロゴ・最後のスライドの画像の保存先が自分の団体の設定の場所でない
--         22023＝項目が足りない／p_closing_images が null・null を含む・3枚以上・同じ保存先が2つ（重複は insert の前に検査して 23505 にしない）
create function public.save_post_style_settings(
  p_band_text text, p_cover_targets text[], p_closing_message text, p_account_introduction text,
  p_caption_footer text, p_fixed_hashtags text[], p_logo_storage_path text default null,
  p_closing_images text[] default '{}') returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_version int; v_id bigint; v_path text;
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
  -- 最後のスライドの画像: 数・重複は insert の前に検査する（上限2は ClosingContent.MAX_IMAGES と同じ）
  if p_closing_images is null or coalesce(array_ndims(p_closing_images), 1) > 1
     or exists (select 1 from unnest(p_closing_images) as c(path) where c.path is null) then
    raise exception '最後のスライドの画像の指定が正しくありません' using errcode = '22023';
  end if;
  if cardinality(p_closing_images) > 2 then
    raise exception '最後のスライドの画像は2枚までです' using errcode = '22023';
  end if;
  if (select count(distinct c.path) from unnest(p_closing_images) as c(path)) <> cardinality(p_closing_images) then
    raise exception '同じ画像を最後のスライドに重ねられません' using errcode = '22023';
  end if;
  for v_path in select c.path from unnest(p_closing_images) as c(path) loop
    if v_path !~ ('^' || me.tenant_id::text || '/style/[A-Za-z0-9_-]+\.jpg$') then
      raise exception '最後のスライドの画像の保存先が正しくありません' using errcode = '42501';
    end if;
  end loop;
  perform 1 from tenants where id = me.tenant_id for no key update;
  select coalesce(max(s.version), 0) + 1 into v_version from post_style_settings s where s.tenant_id = me.tenant_id;
  insert into post_style_settings (tenant_id, version, band_text, cover_targets, closing_message, account_introduction,
                                   caption_footer, fixed_hashtags, created_by)
  values (me.tenant_id, v_version, p_band_text, p_cover_targets, p_closing_message, p_account_introduction,
          p_caption_footer, p_fixed_hashtags, me.member_id) returning id into v_id;
  if p_logo_storage_path is not null then
    insert into post_style_logos (style_settings_id, storage_path) values (v_id, p_logo_storage_path);
  end if;
  -- 順は配列の添字から振る（1, 2。間が空かない）
  insert into post_style_closing_images (style_settings_id, position, storage_path)
  select v_id, c.ord::int, c.path from unnest(p_closing_images) with ordinality as c(path, ord);
  return v_version;
end $$;

revoke execute on function public.save_post_style_settings(text, text[], text, text, text, text[], text, text[]) from public, anon;
grant execute on function public.save_post_style_settings(text, text[], text, text, text, text[], text, text[]) to authenticated;

-- ───────── 3. 承認: 過去の投稿を選ぶ処理を外す ─────────
-- V10 の本文から、TEMPLATE の版で approval_past_posts に入れる処理（と、そのための変数）だけを除いた。それ以外は変えない
create or replace function public.approve_post(p_post uuid, p_revision uuid, p_scheduled_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; requested uuid; ev bigint;
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
end $$;

-- 使う関数を先に置き換えたので、過去の投稿の表紙を引く部品を消す（approve_post 以外は使っていない）
drop function app.past_post_cover(uuid);
