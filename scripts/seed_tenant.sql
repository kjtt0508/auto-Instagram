-- 最初の団体・管理者・設定を登録する（01_DB設計.md 5章。マイグレーションではなく手動で1回だけ流す）
-- 使い方（psql。値は自分の環境に合わせる）:
--   psql "$SUPABASE_DB_URL_PSQL" -v tenant_name='新島info' -v admin_email='you@example.com' \
--        -v admin_name='梶原' -f scripts/seed_tenant.sql
-- 管理者はこのメールアドレスの Google アカウントで初めてログインしたときに結びつく（link_my_member）

\set ON_ERROR_STOP on
begin;

with t as (
  insert into tenants (name) values (:'tenant_name') returning id
), m as (
  insert into members (tenant_id, email, display_name)
  select t.id, :'admin_email', :'admin_name' from t returning id, tenant_id
), r as (
  insert into member_role_changes (member_id, role) select m.id, 'ADMIN' from m
)
insert into tenant_settings (tenant_id, version, llm_provider, llm_model, llm_daily_limit, llm_warn_ratio,
                             publish_grace_minutes, pr_label, auto_draft_enabled)
select m.tenant_id, 1,
       'GEMINI', 'gemini-flash',  -- 生成AIは REQ-002 で使う。モデル名は着手時に確定する（要確認）
       200, 0.80,                 -- 1日の生成上限と警告の割合（REQ-002。仮置き）
       360,                       -- 公開猶予 6時間（BR-001-08。仮置き）
       E'【PR】\n',               -- PR表記（BR-001-05。仮置き）
       false
from m;

-- 登録した団体ID（Storage のパスや確認に使う）
select t.id as tenant_id, t.name, m.email as admin_email
  from tenants t join members m on m.tenant_id = t.id
 where m.email = :'admin_email';

commit;
