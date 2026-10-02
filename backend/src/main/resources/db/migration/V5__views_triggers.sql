-- 追記のみ・状態遷移の最後の砦・導出ビュー・ジョブの実行権（docs/design/01_DB設計.md 2.4, 2.5）

-- ───────── 追記のみ（UPDATE / DELETE 禁止） ─────────
create function app.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0405';
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'tenant_settings','member_auth_links','member_role_changes','member_deactivations',
    'instagram_connections','instagram_token_grants','instagram_token_refresh_failures','instagram_disconnections',
    'posts','post_revisions','post_media','post_events','post_schedules',
    'job_attempts','job_attempt_results','batch_heartbeats',
    'publish_media','ig_containers','post_publications','post_failures']
  loop
    execute format('create trigger %I before update or delete on %I for each row execute function app.forbid_mutation()',
                   t || '_append_only', t);
  end loop;
end $$;

-- ───────── 投稿の状態遷移 ─────────
-- 出来事の from_status が現在の状態と一致することを確かめる。行ロックで同じ投稿の遷移を直列化する。
-- security definer: クライアントのロールには posts の UPDATE 権限が無いため
create function app.check_post_event() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare current_status text;
begin
  perform 1 from posts where id = new.post_id for update;
  select to_status into current_status from post_events
   where post_id = new.post_id order by id desc limit 1;
  if coalesce(current_status, 'NEW') <> new.from_status then
    raise exception 'post % is %, not %', new.post_id, coalesce(current_status, 'NEW'), new.from_status
      using errcode = 'P0409';
  end if;
  return new;
end $$;

create trigger post_events_check before insert on post_events
  for each row execute function app.check_post_event();

-- 版の固定: 新しい版は「作成前」か「下書き」のときだけ
create function app.check_revision_editable() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare current_status text;
begin
  perform 1 from posts where id = new.post_id for update;
  select to_status into current_status from post_events
   where post_id = new.post_id order by id desc limit 1;
  if current_status is not null and current_status <> 'DRAFT' then
    raise exception 'post % is %, revisions are frozen', new.post_id, current_status using errcode = 'P0409';
  end if;
  return new;
end $$;

create trigger post_revisions_editable before insert on post_revisions
  for each row execute function app.check_revision_editable();

-- ───────── 導出ビュー ─────────
create view member_current with (security_invoker = true) as
select m.id as member_id, m.tenant_id, m.email, m.display_name, l.auth_user_id,
       (select r.role from member_role_changes r where r.member_id = m.id order by r.id desc limit 1) as role,
       (d.member_id is null) as active
from members m
left join member_auth_links l on l.member_id = m.id
left join member_deactivations d on d.member_id = m.id;

create view tenant_settings_current with (security_invoker = true) as
select distinct on (tenant_id) * from tenant_settings order by tenant_id, version desc;

-- トークンの表はクライアントから読めない。このビューは service role 用（定期処理・API関数）
create view instagram_connection_current as
select distinct on (c.tenant_id)
       c.id as connection_id, c.tenant_id, c.ig_user_id, c.ig_username, c.connected_at,
       g.expires_at as token_expires_at, g.granted_at as token_granted_at,
       (select max(f.failed_at) from instagram_token_refresh_failures f
         where f.connection_id = c.id and f.failed_at > g.granted_at) as last_refresh_failed_at
from instagram_connections c
join lateral (select expires_at, granted_at from instagram_token_grants
              where connection_id = c.id order by id desc limit 1) g on true
where not exists (select 1 from instagram_disconnections d where d.connection_id = c.id)
order by c.tenant_id, c.connected_at desc;

create view post_current with (security_invoker = true) as
select p.id as post_id, p.tenant_id, p.created_by, p.created_at,
       e.to_status as status, e.occurred_at as status_changed_at,
       r.id as revision_id, r.revision_no, r.format, r.media_source, r.caption, r.pr_category, r.genre_id,
       a.revision_id as approved_revision_id,
       s.scheduled_at,
       pub.ig_media_id, pub.permalink, pub.published_at,
       f.failure_kind as last_failure_kind, f.message as last_failure_message
from posts p
join lateral (select to_status, occurred_at from post_events where post_id = p.id order by id desc limit 1) e on true
join lateral (select * from post_revisions where post_id = p.id order by revision_no desc limit 1) r on true
left join lateral (select revision_id from post_events
                    where post_id = p.id and event_type = 'APPROVED' order by id desc limit 1) a on true
left join lateral (select scheduled_at from post_schedules where post_id = p.id order by id desc limit 1) s on true
left join post_publications pub on pub.post_id = p.id
left join lateral (select failure_kind, message from post_failures where post_id = p.id order by id desc limit 1) f on true;

-- ───────── ジョブの実行権 ─────────
-- 実行期限の長さは JobType（ドメイン）が決めて渡す
create function app.claim_next_job(p_type text, p_lock interval, p_runner text) returns setof jobs
language plpgsql as $$
declare j jobs;
begin
  -- harness-allow: P18 ADR-0006（jobs は予定表）
  update jobs set status = 'RUNNING', attempts = attempts + 1, locked_until = now() + p_lock
   where id = (select id from jobs
                where status = 'PENDING' and run_at <= now() and job_type = p_type
                  and attempts < max_attempts
                order by run_at for update skip locked limit 1)
  returning * into j;
  if j.id is null then
    return;
  end if;
  insert into job_attempts (job_id, attempt_no, runner) values (j.id, j.attempts, p_runner);
  return next j;
end $$;
