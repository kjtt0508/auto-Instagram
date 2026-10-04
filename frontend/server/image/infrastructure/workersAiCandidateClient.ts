import type { ImageGenerator } from "../../../src/domain/image/ImageGenerator";
import type { CandidateImageClient } from "../application/imageGenerationPorts";

// Cloudflare Workers AI の AI バインディングで候補を1枚作る（ADR-0008）。キーは要らない
const STEPS = 4;

/** Pages Functions の AI バインディング（使う部分だけ） */
export type WorkersAiBinding = { run(model: string, input: { prompt: string; steps: number }): Promise<{ image?: string }> };

export class WorkersAiCandidateClient implements CandidateImageClient {
  constructor(private readonly ai: WorkersAiBinding) {}

  async generate(generator: ImageGenerator, englishPrompt: string): Promise<Uint8Array> {
    if (generator.provider !== "CLOUDFLARE_WORKERS_AI") throw new Error(`この提供元には対応していません: ${generator.provider}`);
    const result = await this.ai.run(generator.model, { prompt: englishPrompt, steps: STEPS });
    if (!result.image) throw new Error("Workers AI が画像を返しませんでした");
    return Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
  }
}
