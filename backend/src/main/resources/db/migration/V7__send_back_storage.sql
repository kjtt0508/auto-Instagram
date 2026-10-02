-- 承認待ちを下書きに戻す RPC、Instagram連携の記録・解除 RPC、下書き保存 RPC の戻り値の変更、
-- メンバー管理 RPC の制約（自分自身・最後の管理者）、Storage のバケット・ポリシー
-- （REQ-001 設計 3章 S-04・S-11、4章、01_DB設計.md 4章）

-- ───────── RPC: 承認待ちを下書きに戻す（フェーズ3で修正指示に置き換える） ─────────
create function public.send_back_to_draft(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  perform app.lock_own_post(p_post, me.tenant_id);
  insert into post_events (post_id, event_type, from_status, to_status, actor_member_id)
  values (p_post, 'REVISION_REQUESTED', 'AWAITING_APPROVAL', 'DRAFT', me.member_id);
end $$;

-- ───────── RPC: 下書きを保存する（V6 の版を、保存した版IDも返す形に置き換える） ─────────
-- 保存の直後に最新の版を読み直すと、その間に他の人が保存した版IDを受け取ってしまうため（承認依頼の版の取り違え）
drop function public.save_post_revision(uuid, jsonb);

-- p_revision: {format, mediaSource, caption, prCategory, genreId?, media:[{position, storagePath, width, height, byteSize}]}
create function public.save_post_revision(p_post uuid, p_revision jsonb) returns table (post_id uuid, revision_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; v_post uuid := p_post; rev uuid; next_no int; item jsonb;
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
    if position((me.tenant_id::text || '/') in (item ->> 'storagePath')) <> 1 then
      raise exception '他の団体の画像は使えません' using errcode = '42501';
    end if;
    insert into post_media (revision_id, position, storage_path, width, height, byte_size)
    values (rev, (item ->> 'position')::int, item ->> 'storagePath', (item ->> 'width')::int,
            (item ->> 'height')::int, (item ->> 'byteSize')::int);
  end loop;
  if next_no = 1 then
    insert into post_events (post_id, event_type, from_status, to_status, revision_id, actor_member_id)
    values (v_post, 'CREATED', 'NEW', 'DRAFT', rev, me.member_id);
  end if;
  return query select v_post, rev;
end $$;

-- ───────── メンバー: 自分自身は変えられず、最後の管理者は外せない（BR-001-01, AC-001-24） ─────────
-- 管理者がいなくなると Instagram 連携を誰も扱えなくなるため。V6 の change_member_role / deactivate_member を置き換える
create function app.require_admin_remains(p_tenant uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from member_current where member_id = p_target and role = 'ADMIN' and active)
     and (select count(*) from member_current where tenant_id = p_tenant and role = 'ADMIN' and active) <= 1 then
    raise exception '最後の管理者は外せません' using errcode = '22023';
  end if;
end $$;

create or replace function public.change_member_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; target record;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  if p_member = me.member_id then
    raise exception '自分自身のロールは変えられません' using errcode = '22023';
  end if;
  select * into target from member_current where member_id = p_member and tenant_id = me.tenant_id;
  if target.member_id is null then
    raise exception 'メンバーが見つかりません' using errcode = 'P0404';
  end if;
  perform app.require_role_assignable(me.role, target.role);
  perform app.require_role_assignable(me.role, p_role);
  if p_role <> 'ADMIN' then
    perform app.require_admin_remains(me.tenant_id, p_member);
  end if;
  insert into member_role_changes (member_id, role, changed_by) values (p_member, p_role, me.member_id);
end $$;

create or replace function public.deactivate_member(p_member uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; target record;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  if p_member = me.member_id then
    raise exception '自分自身は無効化できません' using errcode = '22023';
  end if;
  select * into target from member_current where member_id = p_member and tenant_id = me.tenant_id;
  if target.member_id is null then
    raise exception 'メンバーが見つかりません' using errcode = 'P0404';
  end if;
  perform app.require_role_assignable(me.role, target.role);
  perform app.require_admin_remains(me.tenant_id, p_member);
  insert into member_deactivations (member_id, deactivated_by, reason) values (p_member, me.member_id, p_reason);
end $$;

revoke execute on function app.require_admin_remains(uuid, uuid) from public;

-- ───────── Instagram連携: 1団体に1つ（BR-001-02） ─────────
-- 団体の未解除の連携をすべて解除する。連携し直すとき・解除するときに使い、前の連携（まだ有効なトークン）を残さない
create function app.disconnect_all_instagram(p_tenant uuid, p_member uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into instagram_disconnections (connection_id, disconnected_by)
  select c.id, p_member from instagram_connections c
   where c.tenant_id = p_tenant
     and not exists (select 1 from instagram_disconnections d where d.connection_id = c.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- RPC: Instagram連携を解除する（管理者のみ。S-11）
create function public.disconnect_instagram() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from app.require_role(array['ADMIN']);
  if app.disconnect_all_instagram(me.tenant_id, me.member_id) = 0 then
    raise exception 'Instagramと連携していません' using errcode = 'P0404';
  end if;
end $$;

-- RPC: Instagram連携を記録する（API関数の OAuth コールバックだけが呼ぶ。service role のみ）
-- 前の連携の解除・新しい連携・最初のトークンを同じトランザクションで記録する。暗号文は API関数が AES-256-GCM で作る（ADR-0007）
create function public.record_instagram_connection(
  p_connection uuid, p_tenant uuid, p_member uuid, p_ig_user_id text, p_ig_username text, p_account_type text,
  p_token_ciphertext text, p_token_iv text, p_key_version smallint, p_expires_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.disconnect_all_instagram(p_tenant, p_member);
  insert into instagram_connections (id, tenant_id, ig_user_id, ig_username, account_type, connected_by)
  values (p_connection, p_tenant, p_ig_user_id, p_ig_username, p_account_type, p_member);
  insert into instagram_token_grants (connection_id, grant_kind, token_ciphertext, token_iv, key_version, expires_at)
  values (p_connection, 'INITIAL', decode(p_token_ciphertext, 'base64'), decode(p_token_iv, 'base64'),
          p_key_version, p_expires_at);
end $$;

-- ───────── 権限 ─────────
revoke execute on function app.disconnect_all_instagram(uuid, uuid) from public;
revoke execute on function public.record_instagram_connection(uuid, uuid, uuid, text, text, text, text, text, smallint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_instagram_connection(uuid, uuid, uuid, text, text, text, text, text, smallint, timestamptz)
  to service_role;

revoke execute on function public.send_back_to_draft(uuid), public.disconnect_instagram(),
  public.save_post_revision(uuid, jsonb) from public, anon;
grant execute on function public.send_back_to_draft(uuid), public.disconnect_instagram(),
  public.save_post_revision(uuid, jsonb) to authenticated;

-- ───────── Storage（Supabase が用意する storage スキーマがあるときだけ作る） ─────────
-- uploads-private: 下書きの画像。メンバーが自団体のパス（{tenant_id}/...）にだけ書けて読める
-- media-public: 公開用画像。定期処理（service role）だけが書き、Instagram が取得するため誰でも読める
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage スキーマが無いため、バケットとポリシーを作りません（Supabase 以外の DB）';
    return;
  end if;
  insert into storage.buckets (id, name, public) values
    ('uploads-private', 'uploads-private', false),
    ('media-public', 'media-public', true)
  on conflict (id) do nothing;
  create policy uploads_private_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'uploads-private'
                and exists (select 1 from app.current_member() cm
                             where cm.tenant_id::text = (storage.foldername(name))[1]));
  create policy uploads_private_read on storage.objects for select to authenticated
    using (bucket_id = 'uploads-private'
           and exists (select 1 from app.current_member() cm
                        where cm.tenant_id::text = (storage.foldername(name))[1]));
end $$;
