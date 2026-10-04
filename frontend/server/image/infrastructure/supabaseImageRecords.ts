import type { ImageGeneration } from "../../../src/domain/image/ImageGeneration";
import { ImageGenerationQuota } from "../../../src/domain/image/ImageGenerationQuota";
import { ImageGenerator } from "../../../src/domain/image/ImageGenerator";
import type { SupabaseService } from "../../shared/infrastructure/supabaseService";
import type { GenerationSettings, ImageGenerationRecords, RequestingMember } from "../application/imageGenerationPorts";

// 画像生成の記録・回数・候補の保存（service role。REQ-005 設計 5章、V8）
const CANDIDATE_URL_SECONDS = 60 * 60;

export class SupabaseImageRecords implements ImageGenerationRecords {
  constructor(private readonly supabase: SupabaseService) {}

  memberOf(accessToken: string): Promise<RequestingMember | null> {
    return this.supabase.memberOf(accessToken);
  }

  async settingsOf(tenantId: string): Promise<GenerationSettings> {
    const tenant = encodeURIComponent(tenantId);
    const [image] = await this.supabase.rest<{ provider: string; model: string; daily_limit: number; warn_ratio: number }[]>(
      `image_generation_settings_current?select=provider,model,daily_limit,warn_ratio&tenant_id=eq.${tenant}`);
    const [llm] = await this.supabase.rest<{ llm_model: string; llm_daily_limit: number }[]>(
      `tenant_settings_current?select=llm_model,llm_daily_limit&tenant_id=eq.${tenant}`);
    if (!image || !llm) throw new Error("団体の設定がありません");
    return { generator: ImageGenerator.of(image.provider, image.model), quota: ImageGenerationQuota.of(image.daily_limit, Number(image.warn_ratio)),
      llmModel: llm.llm_model, llmDailyLimit: llm.llm_daily_limit };
  }

  async usedToday(tenantId: string): Promise<number> {
    const rows = await this.supabase.rpc<{ used: number }[]>("image_generation_usage_of", { p_tenant: tenantId });
    return rows[0]?.used ?? 0;
  }

  async tryConsumeLlm(tenantId: string, model: string, limit: number): Promise<boolean> {
    const rows = await this.supabase.rpc<{ allowed: boolean }[]>("try_consume_llm", { p_tenant: tenantId, p_model: model, p_limit: limit });
    return rows[0]?.allowed ?? false;
  }

  async tryConsumeImageGeneration(tenantId: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const rows = await this.supabase.rpc<{ allowed: boolean; used: number }[]>("try_consume_image_generation", { p_tenant: tenantId, p_limit: limit });
    return rows[0] ?? { allowed: false, used: limit };
  }

  saveCandidate(tenantId: string, generationId: string, position: number, jpeg: Uint8Array): Promise<string> {
    return this.supabase.uploadPrivate(candidatePath(tenantId, generationId, position), jpeg, "image/jpeg", CANDIDATE_URL_SECONDS);
  }

  async record(member: RequestingMember, generation: ImageGeneration, generator: ImageGenerator): Promise<void> {
    await this.supabase.rpc("record_image_generation", {
      p_id: generation.id, p_tenant: member.tenantId, p_member: member.memberId, p_style: generation.style.code,
      p_prompt_ja: generation.prompt.text, p_prompt_en: generation.translatedPrompt, p_provider: generator.provider,
      p_model: generator.model, p_outcome: generation.outcome(), p_candidate_count: generation.candidateCount,
    });
  }

  async tenantOfGeneration(generationId: string): Promise<string | null> {
    const rows = await this.supabase.rest<{ tenant_id: string }[]>(
      `image_generations?select=tenant_id&id=eq.${encodeURIComponent(generationId)}`);
    return rows[0]?.tenant_id ?? null;
  }

  async clearCandidates(tenantId: string, generationId: string, positions: readonly number[]): Promise<void> {
    await this.supabase.deletePrivate(positions.map((p) => candidatePath(tenantId, generationId, p)));
  }
}

/** 候補の保存先（ADR-0009。daily もこの形で探して消す） */
const candidatePath = (tenantId: string, generationId: string, position: number) =>
  `${tenantId}/candidates/${generationId}/${position}.jpg`;
