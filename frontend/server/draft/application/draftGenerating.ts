import { GenerationInput } from "../../../src/domain/draft/GenerationInput";
import { GenerationRetryPolicy } from "../../../src/domain/draft/GenerationRetryPolicy";
import { GenerationRoute } from "../../../src/domain/draft/GenerationRoute";
import { Idea } from "../../../src/domain/draft/Idea";
import { LlmUsage } from "../../../src/domain/draft/LlmUsage";
import { PromptPurpose } from "../../../src/domain/draft/PromptPurpose";
import type { PromptVersion } from "../../../src/domain/draft/PromptVersion";
import { RevisionInstruction } from "../../../src/domain/draft/RevisionInstruction";
import { checkDraftOutput, readCurrentDraft, type OutputRules } from "./draftOutputChecking";
import {
  DraftRefusal, LlmCallFailure, type AttemptRecord, type DraftModelClient, type DraftRecords, type GenerationOutcome,
  type RequestingMember,
} from "./draftPorts";
import {
  japanDate, loadContext, requireMember, requireOwnGeneration, requireOwnIdea, usageOf, warn, type DraftContext, type DraftResult,
} from "./draftSupport";

// 下書き案を生成する・修正指示で作り直す（REQ-002 設計 1・4・7章）
// ①認証 → ②投稿の型の設定 → ③ネタを記録 → ④入力とプロンプトを組み立てる → ⑤回数の確保 → ⑥Gemini → ⑦下書き案で検査
// （違反があれば、違反を添えて1回だけ作り直す）→ ⑧生成を記録する
// 作り直してよいか・制限時間は再生成方針（GenerationRetryPolicy）が決める。LLM利用回数を数えるかは生成経路（GenerationRoute）が決める
type Production = {
  member: RequestingMember; started: number; purpose: PromptPurpose; route: GenerationRoute; ideaId: string; ideaText: string;
  prompt: PromptVersion;
  input: GenerationInput; context: DraftContext; rules: OutputRules; schema: Record<string, unknown>;
  revision?: { parentGenerationId: string; instruction: string };
};

export class DraftGenerating {
  constructor(private readonly deps: { records: DraftRecords; model: DraftModelClient; newId: () => string; now: () => number }) {}

  async generate(accessToken: string, request: { ideaText: string }): Promise<DraftResult> {
    const started = this.deps.now();
    const member = await requireMember(this.deps.records, accessToken);
    const violations = Idea.violationsOf(request.ideaText);
    if (violations.length > 0) throw new DraftRefusal("INVALID_IDEA", violations[0], violations);
    const purpose = PromptPurpose.PLAN;
    const context = await loadContext(this.deps.records, member, purpose);
    const idea = Idea.memo({ id: this.deps.newId(), text: request.ideaText });
    await this.deps.records.recordIdea(member, idea.id, idea.text);
    const input = GenerationInput.forPlan({ ideaText: idea.text, today: japanDate(started),
      coverTargets: context.style.coverTargets(), backgroundPhotos: context.photos });
    return this.produce({ member, started, purpose, route: GenerationRoute.API, ideaId: idea.id, ideaText: idea.text, prompt: context.prompt,
      input, context, schema: purpose.outputSchema(),
      rules: { style: context.style, prLabel: context.settings.prLabel, purpose, backgroundPhotoIds: context.photos.map((p) => p.id) } });
  }

  async revise(accessToken: string, generationId: string, request: { instruction: string; current: unknown }): Promise<DraftResult> {
    const started = this.deps.now();
    const purpose = PromptPurpose.REVISE;
    const member = await requireMember(this.deps.records, accessToken);
    const parent = await requireOwnGeneration(this.deps.records, member, generationId);
    const instruction = this.instructionOf(request.instruction);
    const current = readCurrentDraft(request.current);
    if (!current.ok) throw new DraftRefusal("INVALID_REQUEST", current.errors[0], current.errors);
    const idea = await requireOwnIdea(this.deps.records, member, parent.ideaId);
    const context = await loadContext(this.deps.records, member, purpose);
    const input = GenerationInput.forRevision({ ideaText: idea.text, today: japanDate(started), coverTargets: context.style.coverTargets(),
      instruction, currentDraft: current.draft, bodySlideCount: current.keep.bodySlideCount });
    const result = await this.produce({ member, started, purpose, route: GenerationRoute.API, ideaId: idea.id, ideaText: idea.text,
      prompt: context.prompt, input, context, schema: purpose.outputSchema({ bodySlideCount: current.keep.bodySlideCount }),
      rules: { style: context.style, prLabel: context.settings.prLabel, purpose, backgroundPhotoIds: [], keep: current.keep },
      revision: { parentGenerationId: parent.id, instruction: instruction.text } });
    return { ...result, parentGenerationId: parent.id };
  }

  private instructionOf(text: unknown): RevisionInstruction {
    const violations = RevisionInstruction.violationsOf(typeof text === "string" ? text : "");
    if (violations.length > 0 || typeof text !== "string") throw new DraftRefusal("INVALID_REQUEST", violations[0] ?? "修正指示を入力してください", violations);
    return RevisionInstruction.of(text);
  }

  /** ⑤〜⑧。回数を確保してから呼び、違反なら1回だけ作り直し、結果を失敗も含めて記録する */
  private async produce(p: Production): Promise<DraftResult> {
    const generationId = this.deps.newId();
    const model = p.context.settings.llmModel;
    const basePrompt = p.prompt.render(p.input);
    const attempts: AttemptRecord[] = [];
    let prompt = basePrompt;
    for (let retriesDone = 0; ; retriesDone += 1) {
      const usage = await this.reserveUsage(p, generationId, attempts);
      const output = await this.call(p, generationId, attempts, prompt);
      const checked = checkDraftOutput(output, p.rules);
      attempts.push({ model, rawOutput: output, violations: checked.violations });
      if (checked.proposal) {
        const json = checked.proposal.toJson();
        await this.finish(p, generationId, "SUCCEEDED", attempts, json);
        return { generationId, ideaId: p.ideaId, proposal: json, unsupportedFacts: checked.proposal.unsupportedFacts(p.ideaText), usage: usage ? usageOf(usage) : null };
      }
      if (!GenerationRetryPolicy.canRetry(checked.violations, retriesDone, this.remaining(p.started))) {
        await this.finish(p, generationId, "INVALID_OUTPUT", attempts, null);
        throw new DraftRefusal("INVALID_OUTPUT", "生成に失敗しました。手動コピペで続けられます", checked.violations, p.ideaId);
      }
      prompt = basePrompt + GenerationRetryPolicy.correctionNote(checked.violations);
    }
  }

  /** LLM利用回数を1回分確保する。数えない生成経路（手動コピペ）では確保しない。上限なら生成を「上限」として記録して断る */
  private async reserveUsage(p: Production, generationId: string, attempts: AttemptRecord[]): Promise<LlmUsage | undefined> {
    if (!p.route.countsLlmUsage()) return undefined;
    const { quota } = p.context.settings;
    const reserved = await this.deps.records.tryConsumeLlm(p.member.tenantId, p.context.settings.llmModel, quota.dailyLimit);
    if (!reserved.allowed) {
      await this.finish(p, generationId, "QUOTA_EXCEEDED", attempts, null);
      throw new DraftRefusal("LLM_LIMIT_REACHED", "今日のAI生成は上限に達しました。手動コピペで続けられます", [], p.ideaId);
    }
    return LlmUsage.reserved(reserved.used, quota);
  }

  /** Gemini を1回呼ぶ。出力を返せなかったら、その試行を空の出力で記録して 503（429・5xx・接続）か 504（60秒超過）にする */
  private async call(p: Production, generationId: string, attempts: AttemptRecord[], prompt: string): Promise<string> {
    const model = p.context.settings.llmModel;
    try {
      const timeoutMs = this.remaining(p.started);
      if (timeoutMs <= 0) throw new LlmCallFailure("TIMEOUT", "生成の制限時間（60秒）を過ぎました");
      return await this.deps.model.generate({ model, prompt, schema: p.schema, timeoutMs });
    } catch (e) {
      const failure = e instanceof LlmCallFailure ? e : new LlmCallFailure("UNAVAILABLE", "Gemini を呼べませんでした");
      warn("Gemini を呼べなかった", e);
      attempts.push({ model, rawOutput: "", violations: [] });
      const timedOut = failure.kind === "TIMEOUT";
      await this.finish(p, generationId, timedOut ? "TIMEOUT" : "LLM_ERROR", attempts, null);
      throw timedOut
        ? new DraftRefusal("LLM_TIMEOUT", "生成が時間切れになりました。手動コピペで続けられます", [], p.ideaId)
        : new DraftRefusal("LLM_UNAVAILABLE", "いまはAIを使えません。手動コピペで続けられます", [], p.ideaId);
    }
  }

  private remaining(started: number): number {
    return GenerationRetryPolicy.remainingMs(this.deps.now() - started);
  }

  /** 生成の依頼1回を記録する。失敗の記録に失敗しても、利用者に返す理由は変えない（成功の記録に失敗したら 500） */
  private async finish(p: Production, id: string, outcome: GenerationOutcome, attempts: AttemptRecord[], result: unknown): Promise<void> {
    const record = this.deps.records.recordGeneration({ id, member: p.member, purpose: p.purpose, route: p.route, ideaId: p.ideaId,
      promptVersionId: p.prompt.id, input: p.input, outcome, attempts: [...attempts], result, revision: p.revision });
    if (outcome === "SUCCEEDED") await record;
    else await record.catch((e: unknown) => warn("失敗した生成を記録できなかった", e));
  }
}
