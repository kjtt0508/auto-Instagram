import type { ImageGeneration } from "../../../src/domain/image/ImageGeneration";
import type { ImageGenerationQuota } from "../../../src/domain/image/ImageGenerationQuota";
import type { ImageGenerator } from "../../../src/domain/image/ImageGenerator";
import type { ImagePrompt } from "../../../src/domain/image/ImagePrompt";

// 画像生成（REQ-005）でアプリケーションが使う外部のインターフェース。実装は infrastructure（P16）

export type RequestingMember = { memberId: string; tenantId: string };

export type GenerationSettings = { generator: ImageGenerator; quota: ImageGenerationQuota; llmModel: string; llmDailyLimit: number };

/** 画像生成の記録・回数・候補の保存（service role で Supabase を読み書きする） */
export interface ImageGenerationRecords {
  memberOf(accessToken: string): Promise<RequestingMember | null>;
  settingsOf(tenantId: string): Promise<GenerationSettings>;
  usedToday(tenantId: string): Promise<number>;
  tryConsumeLlm(tenantId: string, model: string, limit: number): Promise<boolean>;
  tryConsumeImageGeneration(tenantId: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  saveCandidate(tenantId: string, generationId: string, position: number, jpeg: Uint8Array): Promise<string>;
  record(member: RequestingMember, generation: ImageGeneration, generator: ImageGenerator): Promise<void>;
  tenantOfGeneration(generationId: string): Promise<string | null>;
  clearCandidates(tenantId: string, generationId: string, positions: readonly number[]): Promise<void>;
}

/** 指示の英訳（Gemini）。失敗・時間切れは例外 */
export interface PromptTranslator {
  toEnglish(prompt: ImagePrompt, model: string, timeoutMs: number): Promise<string>;
}

/** 候補を1枚作る（Workers AI など）。失敗は例外 */
export interface CandidateImageClient {
  generate(generator: ImageGenerator, englishPrompt: string): Promise<Uint8Array>;
}

/** 画像生成が進められなかった理由（REQ-005 設計 4章のエラー）。presentation が HTTP に変える */
export class ImageGenerationRefusal extends Error {
  constructor(
    readonly code: "INVALID_PROMPT" | "FORBIDDEN" | "NOT_FOUND" | "IMAGE_LIMIT_REACHED" | "TRANSLATION_UNAVAILABLE"
      | "GENERATION_FAILED" | "GENERATION_TIMEOUT",
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}
