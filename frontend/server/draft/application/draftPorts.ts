import type { GenerationInput } from "../../../src/domain/draft/GenerationInput";
import type { GenerationRoute } from "../../../src/domain/draft/GenerationRoute";
import type { LlmQuota } from "../../../src/domain/draft/LlmQuota";
import type { PromptPurpose } from "../../../src/domain/draft/PromptPurpose";
import type { PromptVersion } from "../../../src/domain/draft/PromptVersion";
import type { PostStyleSettings } from "../../../src/domain/post/PostStyleSettings";

// 下書き案の生成（REQ-002）でアプリケーションが使う外部のインターフェース。実装は infrastructure（P16）

export type RequestingMember = { memberId: string; tenantId: string };

export type DraftSettings = { llmModel: string; quota: LlmQuota; prLabel: string };

export type BackgroundCandidate = { id: string; description: string };

export type StoredIdea = { id: string; tenantId: string; text: string };

export type StoredGeneration = { id: string; tenantId: string; ideaId: string };

export type GenerationOutcome = "SUCCEEDED" | "INVALID_OUTPUT" | "LLM_ERROR" | "QUOTA_EXCEEDED" | "TIMEOUT";

/** LLM 呼び出し1回の記録。呼び出しが出力を返さなかったときの rawOutput は空文字 */
export type AttemptRecord = { model: string; rawOutput: string; violations: string[] };

/** 生成の依頼1回の記録（record_generation の引数に対応する） */
export type GenerationRecord = {
  id: string; member: RequestingMember; purpose: PromptPurpose; route: GenerationRoute; ideaId: string; promptVersionId: string;
  input: GenerationInput; outcome: GenerationOutcome; attempts: AttemptRecord[]; result: unknown;
  revision?: { parentGenerationId: string; instruction: string };
};

/** 生成の記録・設定・回数（service role で Supabase を読み書きする） */
export interface DraftRecords {
  memberOf(accessToken: string): Promise<RequestingMember | null>;
  /** 投稿の型の設定の現在の版。無ければ null */
  styleOf(tenantId: string): Promise<PostStyleSettings | null>;
  settingsOf(tenantId: string): Promise<DraftSettings>;
  /** 使っている背景写真（「使わない」にしていないもの） */
  usableBackgroundPhotos(tenantId: string): Promise<BackgroundCandidate[]>;
  activePromptVersion(tenantId: string, purpose: PromptPurpose): Promise<PromptVersion | null>;
  promptVersionOf(id: string): Promise<{ tenantId: string; version: PromptVersion } | null>;
  ideaOf(id: string): Promise<StoredIdea | null>;
  generationOf(id: string): Promise<StoredGeneration | null>;
  recordIdea(member: RequestingMember, id: string, text: string): Promise<void>;
  tryConsumeLlm(tenantId: string, model: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  recordGeneration(record: GenerationRecord): Promise<void>;
}

/** LLM（Gemini）に JSON スキーマ付きで1回頼む。出力の文字列を返す。失敗・時間切れは LlmCallFailure */
export interface DraftModelClient {
  generate(request: { model: string; prompt: string; schema: Record<string, unknown>; timeoutMs: number }): Promise<string>;
}

/** LLM 呼び出しが出力を返せなかった理由（時間切れ／429・5xx・接続の失敗） */
export class LlmCallFailure extends Error {
  constructor(readonly kind: "TIMEOUT" | "UNAVAILABLE", message: string) {
    super(message);
  }
}

/** 下書き案の生成が進められなかった理由（REQ-002 設計 4章・7章のエラー）。presentation が HTTP に変える */
export class DraftRefusal extends Error {
  constructor(
    readonly code: "INVALID_IDEA" | "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "STYLE_NOT_CONFIGURED" | "LLM_LIMIT_REACHED"
      | "INVALID_OUTPUT" | "INVALID_MANUAL_OUTPUT" | "LLM_UNAVAILABLE" | "LLM_TIMEOUT",
    message: string,
    readonly details: string[] = [],
    /** 記録したネタ（手動コピペで続けられるよう、失敗でも返す） */
    readonly ideaId?: string,
  ) {
    super(message);
  }
}
