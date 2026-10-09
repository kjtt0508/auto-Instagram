import type { DraftProposal } from "../../../src/domain/draft/DraftProposal";
import type { LlmUsage } from "../../../src/domain/draft/LlmUsage";
import type { PromptPurpose } from "../../../src/domain/draft/PromptPurpose";
import type { PromptVersion } from "../../../src/domain/draft/PromptVersion";
import type { PostStyleSettings } from "../../../src/domain/post/PostStyleSettings";
import {
  DraftRefusal, type BackgroundCandidate, type DraftRecords, type DraftSettings, type RequestingMember, type StoredGeneration,
  type StoredIdea,
} from "./draftPorts";

// 下書き案の生成と手動コピペで共通の部品

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const JAPAN_OFFSET_MS = 9 * 60 * 60 * 1000;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** 日本時間の日付（2026-10-05） */
export const japanDate = (epochMs: number): string => new Date(epochMs + JAPAN_OFFSET_MS).toISOString().slice(0, 10);

/** 応答に載せる下書き案の形（POST /api/drafts と同じ。revise は parentGenerationId、手動コピペは usage が null） */
export type DraftResult = {
  generationId: string;
  ideaId: string;
  proposal: ReturnType<DraftProposal["toJson"]>;
  unsupportedFacts: { location: string; fact: string }[];
  usage: { used: number; dailyLimit: number; warnRatio: number; warn: boolean } | null;
  parentGenerationId?: string;
};

export const usageOf = (usage: LlmUsage) =>
  ({ used: usage.used, dailyLimit: usage.quota.dailyLimit, warnRatio: usage.quota.warnRatio, warn: usage.shouldWarn() });

/** 生成に必要な、団体の設定・投稿の型の設定・背景写真の候補・有効なプロンプト版 */
export type DraftContext = {
  style: PostStyleSettings; settings: DraftSettings; photos: BackgroundCandidate[]; prompt: PromptVersion;
};

export async function requireMember(records: DraftRecords, accessToken: string): Promise<RequestingMember> {
  const member = await records.memberOf(accessToken);
  if (!member) throw new DraftRefusal("FORBIDDEN", "利用が許可されていません");
  return member;
}

/** 読み込むだけで何も記録しない（投稿の型の設定が無ければ、ここで 409 にして記録も LLM 呼び出しもしない） */
export async function loadContext(records: DraftRecords, member: RequestingMember, purpose: PromptPurpose): Promise<DraftContext> {
  const style = await records.styleOf(member.tenantId);
  if (!style) throw new DraftRefusal("STYLE_NOT_CONFIGURED", "投稿の型の設定がありません。管理者に設定を依頼してください");
  const [settings, photos, prompt] = await Promise.all([
    records.settingsOf(member.tenantId),
    // 背景写真を選ばせるのは用途が決める（PLAN だけ）。選ばせない用途では候補を読まない
    purpose.choosesBackgroundPhoto() ? records.usableBackgroundPhotos(member.tenantId) : Promise.resolve([]),
    records.activePromptVersion(member.tenantId, purpose),
  ]);
  if (!prompt) throw new Error(`有効なプロンプト版がありません（${purpose.code}）`);
  return { style, settings, photos, prompt };
}

/** 既存のネタを使う。自団体のものだけ（ほかの団体のものは、存在を知らせないよう「見つからない」と同じ 404） */
export async function requireOwnIdea(records: DraftRecords, member: RequestingMember, ideaId: unknown): Promise<StoredIdea> {
  const idea = isUuid(ideaId) ? await records.ideaOf(ideaId) : null;
  if (!idea || idea.tenantId !== member.tenantId) throw new DraftRefusal("NOT_FOUND", "ネタが見つかりません");
  return idea;
}

/** 既存の生成を使う。自団体のものだけ（ほかの団体のものは 404） */
export async function requireOwnGeneration(records: DraftRecords, member: RequestingMember, generationId: unknown): Promise<StoredGeneration> {
  const generation = isUuid(generationId) ? await records.generationOf(generationId) : null;
  if (!generation || generation.tenantId !== member.tenantId) throw new DraftRefusal("NOT_FOUND", "元の生成が見つかりません");
  return generation;
}

/** 既存のプロンプト版を使う。自団体のものだけ（ほかの団体のものは 404） */
export async function requireOwnPromptVersion(records: DraftRecords, member: RequestingMember, id: unknown): Promise<PromptVersion> {
  const stored = isUuid(id) ? await records.promptVersionOf(id) : null;
  if (!stored || stored.tenantId !== member.tenantId) throw new DraftRefusal("NOT_FOUND", "プロンプト版が見つかりません");
  return stored.version;
}

/** 失敗の理由をログに残す（利用者には 502/503/504 としか見えないため）。例外の文言は状態コードだけで、鍵は含まれない */
export function warn(what: string, e: unknown): void {
  console.warn(`[draft-generation] ${what}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
}
