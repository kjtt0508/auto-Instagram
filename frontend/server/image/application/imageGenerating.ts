import { ImageGeneration } from "../../../src/domain/image/ImageGeneration";
import { ImageGenerationUsage } from "../../../src/domain/image/ImageGenerationUsage";
import { ImagePrompt } from "../../../src/domain/image/ImagePrompt";
import { ImageStyle } from "../../../src/domain/post/ImageStyle";
import {
  ImageGenerationRefusal, type CandidateImageClient, type GenerationSettings, type ImageGenerationRecords,
  type PromptTranslator, type RequestingMember,
} from "./imageGenerationPorts";

// 画像生成する（REQ-005 設計 1章）。①検査 → ②回数の事前確認 → ③英訳 → ④回数の確保 → ⑤候補を作る → ⑥記録
const TRANSLATION_TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 60_000;

export type GeneratedCandidates = {
  generationId: string;
  candidates: { position: number; url: string }[];
  usage: { used: number; dailyLimit: number; warnRatio: number };
};

export class ImageGenerating {
  constructor(private readonly deps: {
    records: ImageGenerationRecords; translator: PromptTranslator; images: CandidateImageClient;
    newId: () => string; now: () => number;
  }) {}

  async generate(accessToken: string, request: { style: string; prompt: string }): Promise<GeneratedCandidates> {
    const started = this.deps.now();
    const member = await this.requireMember(accessToken);
    const { style, prompt } = this.parse(request);
    const settings = await this.deps.records.settingsOf(member.tenantId);
    await this.requireRemaining(member, settings);
    const translated = await this.translate(member, prompt, settings);
    const reserved = await this.deps.records.tryConsumeImageGeneration(member.tenantId, settings.quota.dailyLimit);
    if (!reserved.allowed) throw new ImageGenerationRefusal("IMAGE_LIMIT_REACHED", "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください");
    const id = this.deps.newId();
    const { urls, timedOut } = await this.makeCandidates(member, id, settings, translated, started);
    const generation = ImageGeneration.of({ id, style, prompt, translatedPrompt: translated, candidateCount: urls.length });
    await this.recordOrDiscard(member, generation, settings);
    if (!generation.isSucceeded()) throw this.failure(timedOut);
    return { generationId: id, candidates: urls.map((url, i) => ({ position: i + 1, url })),
      usage: { used: reserved.used, dailyLimit: settings.quota.dailyLimit, warnRatio: settings.quota.warnRatio } };
  }

  private async requireMember(accessToken: string): Promise<RequestingMember> {
    const member = await this.deps.records.memberOf(accessToken);
    if (!member) throw new ImageGenerationRefusal("FORBIDDEN", "利用が許可されていません");
    return member;
  }

  private parse(request: { style: string; prompt: string }) {
    const violations = ImagePrompt.violationsOf(request.prompt ?? "");
    if (violations.length > 0) throw new ImageGenerationRefusal("INVALID_PROMPT", violations[0], violations);
    const style = ImageStyle.all().find((s) => s.code === request.style);
    if (!style) throw new ImageGenerationRefusal("INVALID_PROMPT", "画像の種類を選んでください");
    return { style, prompt: ImagePrompt.of(request.prompt) };
  }

  /** ②確保しない事前確認。上限なら英訳もしない（LLM利用回数を使わない） */
  private async requireRemaining(member: RequestingMember, settings: GenerationSettings): Promise<void> {
    const usage = ImageGenerationUsage.of(await this.deps.records.usedToday(member.tenantId), settings.quota);
    if (!usage.canGenerate()) throw new ImageGenerationRefusal("IMAGE_LIMIT_REACHED", "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください");
  }

  /** ③英訳できなければ画像生成しない（BR-005-10） */
  private async translate(member: RequestingMember, prompt: ImagePrompt, settings: GenerationSettings): Promise<string> {
    const unavailable = new ImageGenerationRefusal("TRANSLATION_UNAVAILABLE", "いまは画像を作れません。写真を撮る・選ぶで続けてください");
    if (!(await this.deps.records.tryConsumeLlm(member.tenantId, settings.llmModel, settings.llmDailyLimit))) throw unavailable;
    const translated = await this.deps.translator.toEnglish(prompt, settings.llmModel, TRANSLATION_TIMEOUT_MS).catch(() => "");
    if (translated.trim() === "") throw unavailable;
    return translated;
  }

  /** ⑤候補を作って保存する。全体60秒の残りの時間で打ち切る。作れた分だけ、位置 1 から詰めて保存する */
  private async makeCandidates(member: RequestingMember, id: string, settings: GenerationSettings, prompt: string, started: number) {
    const remaining = Math.max(0, TOTAL_TIMEOUT_MS - (this.deps.now() - started));
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); }, remaining);
    });
    deadline.catch(() => undefined);
    const results = await Promise.allSettled(Array.from({ length: ImageGeneration.CANDIDATES_PER_GENERATION },
      () => Promise.race([this.deps.images.generate(settings.generator, prompt), deadline])));
    clearTimeout(timer);
    const images = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const urls: string[] = [];
    for (const jpeg of images) {
      // 保存できなかった画像は候補にしない（位置は保存できた順に 1 から詰める）
      const url = await this.deps.records.saveCandidate(member.tenantId, id, urls.length + 1, jpeg).catch(() => null);
      if (url) urls.push(url);
    }
    return { urls, timedOut: timedOut && urls.length === 0 };
  }

  /** ⑥記録できなければ、保存した候補を消してから失敗にする（記録の無い候補は daily が辿れない） */
  private async recordOrDiscard(member: RequestingMember, generation: ImageGeneration, settings: GenerationSettings): Promise<void> {
    try {
      await this.deps.records.record(member, generation, settings.generator);
    } catch (e) {
      await this.deps.records.clearCandidates(member.tenantId, generation.id, generation.candidates().map((c) => c.position))
        .catch(() => undefined);
      throw e;
    }
  }

  private failure(timedOut: boolean): ImageGenerationRefusal {
    return timedOut
      ? new ImageGenerationRefusal("GENERATION_TIMEOUT", "画像を生成できませんでした（時間切れ）")
      : new ImageGenerationRefusal("GENERATION_FAILED", "画像を生成できませんでした");
  }
}
