-- 生成AIのモデル名を仮置き（gemini-flash）から実在のモデル名にする（REQ-005 の英訳で初めて使う。2026-10-04 確認）
-- 団体設定は版で追記する（上書きしない）。仮置きのままの団体だけ、最新の版を写して新しい版を足す
insert into tenant_settings (tenant_id, version, llm_provider, llm_model, llm_daily_limit, llm_warn_ratio,
                             publish_grace_minutes, pr_label, auto_draft_enabled)
select s.tenant_id, s.version + 1, s.llm_provider, 'gemini-3.5-flash-lite', s.llm_daily_limit, s.llm_warn_ratio,
       s.publish_grace_minutes, s.pr_label, s.auto_draft_enabled
  from tenant_settings s
 where s.version = (select max(version) from tenant_settings x where x.tenant_id = s.tenant_id)
   and s.llm_model = 'gemini-flash';
