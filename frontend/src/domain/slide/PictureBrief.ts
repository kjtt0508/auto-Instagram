import { ImagePrompt } from "../image/ImagePrompt";

/**
 * 絵の指示: 中のスライドの素材画像を画像生成するための指示と、実在の素材（ロゴ・料金表・アプリの画面）への差し替えが必要かの印。
 * AI が下書き案に含めて返し、人が直せる。指示は画像生成の指示（ImagePrompt）の条件を満たす。
 * 固有名詞・商標を入れないことは AI への指示（プロンプト版）で守らせ、実物が要るスライドは差し替えが必要の印で人に回す（BR-002-19）
 */
export class PictureBrief {
  private constructor(private readonly prompt: string, private readonly replacement: boolean) {}

  /** 満たさない条件（画像生成の指示に委ねる） */
  static violationsOf(prompt: string): string[] {
    return ImagePrompt.violationsOf(prompt);
  }

  static of(parts: { prompt: string; replacementNeeded: boolean }): PictureBrief {
    const violations = PictureBrief.violationsOf(parts.prompt);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new PictureBrief(parts.prompt.trim(), parts.replacementNeeded);
  }

  /** 記録から戻すときは検査しない */
  static restore(parts: { prompt: string; replacementNeeded: boolean }): PictureBrief {
    return new PictureBrief(parts.prompt, parts.replacementNeeded);
  }

  /** 画像生成（REQ-005）に渡す指示 */
  imagePrompt(): ImagePrompt {
    return ImagePrompt.of(this.prompt);
  }

  /** 指示の文（画面に出す・直す） */
  promptText(): string {
    return this.prompt;
  }

  /** 実物の画像への差し替えが必要か（画面で印を出す） */
  needsReplacement(): boolean {
    return this.replacement;
  }
}
