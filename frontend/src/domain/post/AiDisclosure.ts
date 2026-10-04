import type { PostMediaList } from "./PostMediaList";

/**
 * AI生成の表示: 写真風の生成画像を含む投稿を公開するときに付ける開示（REQ-005 BR-005-05）。
 * キャプション末尾の定型文（改行1つ＋文言。改行込み18文字）と、Instagram の AI info（is_ai_generated）。Java の AiDisclosure と揃える
 */
export class AiDisclosure {
  static readonly TEXT = "※画像はAIで生成したイメージです";
  static readonly SEPARATOR = "\n";
  static readonly NAME = "AI生成の表示";

  private constructor(private readonly required: boolean) {}

  /** 投稿画像一覧から、表示が要るかを決める（写真風の生成画像を1枚でも含むとき） */
  static of(media: PostMediaList): AiDisclosure {
    return new AiDisclosure(media.requiresAiDisclosure());
  }

  isRequired(): boolean {
    return this.required;
  }

  /** 公開用キャプションの末尾に付ける文字列（不要なら空） */
  suffix(): string {
    return this.required ? AiDisclosure.SEPARATOR + AiDisclosure.TEXT : "";
  }
}
