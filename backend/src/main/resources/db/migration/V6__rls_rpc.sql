-- 行レベルセキュリティと、画面から呼ぶ RPC（docs/design/01_DB設計.md 3章、REQ-001.md 4章）
-- RPC は「記録・権限・版の整合」だけを担う。業務判断（予約日時の妥当性・画像仕様・文字数）は画面のドメインで行う

-- ───────── ログイン中のメンバー ─────────
create function app.current_member() returns table (member_id uuid, tenant_id uuid, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select mc.member_id, mc.tenant_id, mc.role from member_current mc
   where mc.auth_user_id = auth.uid() and mc.active
$$;

create function app.is_member(t uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app.current_member() cm where cm.tenant_id = t)
$$;

create function app.has_role(t uuid, roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from app.current_member() cm where cm.tenant_id = t and cm.role = any(roles))
$$;

create function app.can_read_post(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from posts where id = p and app.is_member(tenant_id))
$$;

create function app.can_read_revision(rv uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from post_revisions r join posts p on p.id = r.post_id
                  where r.id = rv and app.is_member(p.tenant_id))
$$;

-- RPC の共通部品: メンバーでなければ拒否
create function app.require_member() returns table (member_id uuid, tenant_id uuid, role text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select * from app.current_member();
  if not found then
    raise exception '利用が許可されていません' using errcode = '42501';
  end if;
end $$;

create function app.require_role(roles text[]) returns table (member_id uuid, tenant_id uuid, role text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select * from app.require_member() m where m.role = any(roles);
  if not found then
    raise exception '権限がありません' using errcode = '42501';
  end if;
end $$;

-- 自団体の投稿であることを確かめ、現在の状態を返す
create function app.lock_own_post(p_post uuid, p_tenant uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  perform 1 from posts where id = p_post and tenant_id = p_tenant for update;
  if not found then
    raise exception '投稿が見つかりません' using errcode = 'P0404';
  end if;
  select to_status into s from post_events where post_id = p_post order by id desc limit 1;
  return s;
end $$;

-- ───────── RLS ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'tenants','tenant_settings','members','member_auth_links','member_role_changes','member_deactivations','genres',
    'oauth_states','instagram_connections','instagram_token_grants','instagram_token_refresh_failures',
    'instagram_disconnections','posts','post_revisions','post_media','post_status_transitions','post_events',
    'post_schedules','jobs','job_attempts','job_attempt_results','batch_heartbeats','publish_media',
    'ig_containers','post_publications','post_failures']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy tenants_read on tenants for select to authenticated using (app.is_member(id));
create policy tenant_settings_read on tenant_settings for select to authenticated using (app.is_member(tenant_id));
create policy tenant_settings_write on tenant_settings for insert to authenticated
  with check (app.has_role(tenant_id, array['ADMIN']));
create policy members_read on members for select to authenticated using (app.is_member(tenant_id));
create policy member_role_changes_read on member_role_changes for select to authenticated
  using (exists (select 1 from members m where m.id = member_id and app.is_member(m.tenant_id)));
create policy member_deactivations_read on member_deactivations for select to authenticated
  using (exists (select 1 from members m where m.id = member_id and app.is_member(m.tenant_id)));
create policy member_auth_links_read on member_auth_links for select to authenticated using (auth_user_id = auth.uid());
create policy genres_read on genres for select to authenticated using (app.is_member(tenant_id));
create policy genres_write on genres for insert to authenticated
  with check (app.has_role(tenant_id, array['ADMIN','APPROVER']));

create policy posts_read on posts for select to authenticated using (app.is_member(tenant_id));
create policy post_revisions_read on post_revisions for select to authenticated using (app.can_read_post(post_id));
create policy post_media_read on post_media for select to authenticated using (app.can_read_revision(revision_id));
create policy post_status_transitions_read on post_status_transitions for select to authenticated using (true);
create policy post_events_read on post_events for select to authenticated using (app.can_read_post(post_id));
create policy post_schedules_read on post_schedules for select to authenticated using (app.can_read_post(post_id));
create policy publish_media_read on publish_media for select to authenticated using (app.can_read_revision(revision_id));
create policy ig_containers_read on ig_containers for select to authenticated using (app.can_read_post(post_id));
create policy post_publications_read on post_publications for select to authenticated using (app.can_read_post(post_id));
create policy post_failures_read on post_failures for select to authenticated using (app.can_read_post(post_id));
create policy jobs_read on jobs for select to authenticated using (app.is_member(tenant_id));
create policy job_attempts_read on job_attempts for select to authenticated
  using (exists (select 1 from jobs j where j.id = job_id and app.has_role(j.tenant_id, array['ADMIN'])));
create policy job_attempt_results_read on job_attempt_results for select to authenticated
  using (exists (select 1 from job_attempts a join jobs j on j.id = a.job_id
                  where a.id = job_attempt_id and app.has_role(j.tenant_id, array['ADMIN'])));
create policy batch_heartbeats_read on batch_heartbeats for select to authenticated using (true);
-- oauth_states / instagram_* にはポリシーを付けない（service role のみ）

revoke all on instagram_connection_current from anon, authenticated;

-- ───────── RPC: メンバー ─────────
create function public.link_my_member() returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare m uuid;
begin
  select id into m from members
   where email = (auth.jwt() ->> 'email')::citext
     and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false)
     and not exists (select 1 from member_auth_links l where l.member_id = members.id)
     and not exists (select 1 from member_deactivations d where d.member_id = members.id)
   limit 1;
  if m is not null then
    insert into member_auth_links (member_id, auth_user_id) values (m, auth.uid());
  end if;
  return m;
end $$;

-- 管理者ロールに関わる操作は管理者だけ（AC-001-23）
create function app.require_role_assignable(me_role text, target_role text) returns void
language plpgsql immutable as $$
begin
  if target_role = 'ADMIN' and me_role <> 'ADMIN' then
    raise exception '管理者ロールは管理者だけが扱えます' using errcode = '42501';
  end if;
end $$;

create function public.invite_member(p_email text, p_display_name text, p_role text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; m uuid;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  perform app.require_role_assignable(me.role, p_role);
  insert into members (tenant_id, email, display_name, invited_by)
  values (me.tenant_id, p_email, p_display_name, me.member_id) returning id into m;
  insert into member_role_changes (member_id, role, changed_by) values (m, p_role, me.member_id);
  return m;
end $$;

create function public.change_member_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; target record;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  select * into target from member_current where member_id = p_member and tenant_id = me.tenant_id;
  if target.member_id is null then
    raise exception 'メンバーが見つかりません' using errcode = 'P0404';
  end if;
  perform app.require_role_assignable(me.role, target.role);
  perform app.require_role_assignable(me.role, p_role);
  insert into member_role_changes (member_id, role, changed_by) values (p_member, p_role, me.member_id);
end $$;

create function public.deactivate_member(p_member uuid, p_reason text) returns void
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
  insert into member_deactivations (member_id, deactivated_by, reason) values (p_member, me.member_id, p_reason);
end $$;

-- ───────── RPC: Instagram連携の状態（暗号文なし） ─────────
create function public.instagram_connection_status()
returns table (ig_username text, connected_at timestamptz, token_expires_at timestamptz,
               last_refresh_failed_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.ig_username, v.connected_at, v.token_expires_at, v.last_refresh_failed_at
    from instagram_connection_current v
   where v.tenant_id = (select cm.tenant_id from app.current_member() cm)
$$;

-- ───────── RPC: 投稿 ─────────
-- p_revision: {format, mediaSource, caption, prCategory, genreId?, media:[{position, storagePath, width, height, byteSize}]}
create function public.save_post_revision(p_post uuid, p_revision jsonb) returns uuid
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
  return v_post;
end $$;

create function public.request_approval(p_post uuid, p_revision uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; latest uuid;
begin
  select * into me from app.require_member();
  perform app.lock_own_post(p_post, me.tenant_id);
  select id into latest from post_revisions where post_id = p_post order by revision_no desc limit 1;
  if latest is distinct from p_revision then
    raise exception '最新の版ではありません。画面を更新してください' using errcode = 'P0409';
  end if;
  insert into post_events (post_id, event_type, from_status, to_status, revision_id, actor_member_id)
  values (p_post, 'APPROVAL_REQUESTED', 'DRAFT', 'AWAITING_APPROVAL', p_revision, me.member_id);
end $$;

create function public.approve_post(p_post uuid, p_revision uuid, p_scheduled_at timestamptz) returns void
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

create function public.cancel_schedule(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  perform app.lock_own_post(p_post, me.tenant_id);
  insert into post_events (post_id, event_type, from_status, to_status, actor_member_id)
  values (p_post, 'SCHEDULE_CANCELLED', 'SCHEDULED', 'DRAFT', me.member_id);
end $$;

create function public.retry_post(p_post uuid, p_scheduled_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; approved uuid; ev bigint;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  perform app.lock_own_post(p_post, me.tenant_id);
  select revision_id into approved from post_events
   where post_id = p_post and event_type = 'APPROVED' order by id desc limit 1;
  insert into post_events (post_id, event_type, from_status, to_status, revision_id, actor_member_id)
  values (p_post, 'RETRIED', 'FAILED', 'SCHEDULED', approved, me.member_id) returning id into ev;
  insert into post_schedules (post_id, event_id, scheduled_at, decided_by) values (p_post, ev, p_scheduled_at, me.member_id);
end $$;

create function public.return_to_draft(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record;
begin
  select * into me from app.require_role(array['ADMIN','APPROVER']);
  perform app.lock_own_post(p_post, me.tenant_id);
  insert into post_events (post_id, event_type, from_status, to_status, actor_member_id)
  values (p_post, 'RETURNED_TO_DRAFT', 'FAILED', 'DRAFT', me.member_id);
end $$;

-- 下書きの破棄は全ロール、それ以外（承認待ち・失敗）の破棄は承認者以上
create function public.discard_post(p_post uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare me record; current_status text;
begin
  select * into me from app.require_member();
  current_status := app.lock_own_post(p_post, me.tenant_id);
  if current_status <> 'DRAFT' and me.role not in ('ADMIN','APPROVER') then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  insert into post_events (post_id, event_type, from_status, to_status, actor_member_id)
  values (p_post, 'DISCARDED', current_status, 'DISCARDED', me.member_id);
end $$;

-- ───────── 権限 ─────────
grant usage on schema app to authenticated;
revoke execute on all functions in schema app from public;
grant execute on function app.current_member(), app.is_member(uuid), app.has_role(uuid, text[]),
  app.can_read_post(uuid), app.can_read_revision(uuid) to authenticated;

revoke execute on function public.link_my_member(), public.invite_member(text, text, text),
  public.change_member_role(uuid, text), public.deactivate_member(uuid, text),
  public.instagram_connection_status(), public.save_post_revision(uuid, jsonb),
  public.request_approval(uuid, uuid), public.approve_post(uuid, uuid, timestamptz),
  public.cancel_schedule(uuid), public.retry_post(uuid, timestamptz),
  public.return_to_draft(uuid), public.discard_post(uuid) from public, anon;
grant execute on function public.link_my_member(), public.invite_member(text, text, text),
  public.change_member_role(uuid, text), public.deactivate_member(uuid, text),
  public.instagram_connection_status(), public.save_post_revision(uuid, jsonb),
  public.request_approval(uuid, uuid), public.approve_post(uuid, uuid, timestamptz),
  public.cancel_schedule(uuid), public.retry_post(uuid, timestamptz),
  public.return_to_draft(uuid), public.discard_post(uuid) to authenticated;
