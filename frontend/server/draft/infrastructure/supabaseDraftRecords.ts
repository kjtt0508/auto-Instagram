import { LlmQuota } from "../../../src/domain/draft/LlmQuota";
import { PromptPurpose } from "../../../src/domain/draft/PromptPurpose";
import { PromptVersion } from "../../../src/domain/draft/PromptVersion";
import { CaptionFooter } from "../../../src/domain/post/CaptionFooter";
import { FixedHashtags } from "../../../src/domain/post/FixedHashtags";
import { PostStyleSettings } from "../../../src/domain/post/PostStyleSettings";
import type { SupabaseService } from "../../shared/infrastructure/supabaseService";
import type {
  BackgroundCandidate, DraftRecords, DraftSettings, GenerationRecord, RequestingMember, StoredGeneration, StoredIdea,
} from "../application/draftPorts";

// 下書き案の生成の記録・設定・回数（service role。REQ-002 設計 5章、V10）
const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

type PromptRow = { prompt_version_id?: string; id?: string; version_no: number; body: string; purpose?: string; tenant_id?: string };

export class SupabaseDraftRecords implements DraftRecords {
  constructor(private readonly supabase: SupabaseService) {}

  memberOf(accessToken: string): Promise<RequestingMember | null> {
    return this.supabase.memberOf(accessToken);
  }

  async styleOf(tenantId: string): Promise<PostStyleSettings | null> {
    const [row] = await this.supabase.rest<{
      tenant_id: string; version: number; band_text: string; cover_targets: string[]; closing_message: string;
      account_introduction: string; caption_footer: string; fixed_hashtags: string[];
    }[]>(`post_style_settings_current?select=tenant_id,version,band_text,cover_targets,closing_message,account_introduction,caption_footer,fixed_hashtags&tenant_id=${eq(tenantId)}`);
    return row ? PostStyleSettings.of({ tenantId: row.tenant_id, version: row.version, bandText: row.band_text, coverTargets: row.cover_targets,
      closingMessage: row.closing_message, accountIntroduction: row.account_introduction, captionFooter: CaptionFooter.of(row.caption_footer),
      fixedHashtags: FixedHashtags.of(row.fixed_hashtags) }) : null;
  }

  async settingsOf(tenantId: string): Promise<DraftSettings> {
    const [row] = await this.supabase.rest<{ llm_model: string; llm_daily_limit: number; llm_warn_ratio: number | string; pr_label: string }[]>(
      `tenant_settings_current?select=llm_model,llm_daily_limit,llm_warn_ratio,pr_label&tenant_id=${eq(tenantId)}`);
    if (!row) throw new Error("団体の設定がありません");
    return { llmModel: row.llm_model, quota: LlmQuota.of(row.llm_daily_limit, Number(row.llm_warn_ratio)), prLabel: row.pr_label };
  }

  usableBackgroundPhotos(tenantId: string): Promise<BackgroundCandidate[]> {
    return this.supabase.rest<BackgroundCandidate[]>(
      `usable_background_photos?select=id,description&tenant_id=${eq(tenantId)}&order=registered_at.asc,id.asc`);
  }

  async activePromptVersion(tenantId: string, purpose: PromptPurpose): Promise<PromptVersion | null> {
    const [row] = await this.supabase.rest<PromptRow[]>(
      `active_prompt_versions?select=prompt_version_id,version_no,body&tenant_id=${eq(tenantId)}&purpose=${eq(purpose.code)}`);
    return row ? PromptVersion.restore({ id: row.prompt_version_id!, purpose, versionNo: row.version_no, body: row.body }) : null;
  }

  async promptVersionOf(id: string): Promise<{ tenantId: string; version: PromptVersion } | null> {
    const [row] = await this.supabase.rest<PromptRow[]>(`prompt_versions?select=id,tenant_id,purpose,version_no,body&id=${eq(id)}`);
    return row ? { tenantId: row.tenant_id!, version: PromptVersion.restore({ id: row.id!, purpose: PromptPurpose.from(row.purpose!),
      versionNo: row.version_no, body: row.body }) } : null;
  }

  async ideaOf(id: string): Promise<StoredIdea | null> {
    const [row] = await this.supabase.rest<{ id: string; tenant_id: string; body: string }[]>(`ideas?select=id,tenant_id,body&id=${eq(id)}`);
    return row ? { id: row.id, tenantId: row.tenant_id, text: row.body } : null;
  }

  async generationOf(id: string): Promise<StoredGeneration | null> {
    const [row] = await this.supabase.rest<{ id: string; tenant_id: string; idea_id: string }[]>(`generations?select=id,tenant_id,idea_id&id=${eq(id)}`);
    return row ? { id: row.id, tenantId: row.tenant_id, ideaId: row.idea_id } : null;
  }

  async recordIdea(member: RequestingMember, id: string, text: string): Promise<void> {
    await this.supabase.rpc("record_idea", { p_id: id, p_tenant: member.tenantId, p_member: member.memberId, p_body: text });
  }

  async tryConsumeLlm(tenantId: string, model: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const rows = await this.supabase.rpc<{ allowed: boolean; used: number }[]>("try_consume_llm", { p_tenant: tenantId, p_model: model, p_limit: limit });
    return rows[0] ?? { allowed: false, used: limit };
  }

  async recordGeneration(record: GenerationRecord): Promise<void> {
    await this.supabase.rpc("record_generation", {
      p_id: record.id, p_tenant: record.member.tenantId, p_member: record.member.memberId, p_purpose: record.purpose.code,
      p_route: record.route.code, p_idea: record.ideaId, p_prompt_version: record.promptVersionId, p_input: record.input.toJson(),
      p_outcome: record.outcome, p_attempts: record.attempts, p_result: record.result,
      p_parent: record.revision?.parentGenerationId ?? null, p_instruction: record.revision?.instruction ?? null,
    });
  }
}
