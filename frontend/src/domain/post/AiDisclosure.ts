import type { PostRevision } from "./PostRevision";

/**
 * AI生成の表示: 写真風の生成画像（投稿画像そのもの、または中のスライドの素材画像）を含む投稿を公開するときに付ける開示（REQ-005 BR-005-05）。
 * キャプション末尾の定型文（改行1つ＋文言。改行込み18文字）と、Instagram の AI info（is_ai_generated）。Java の AiDisclosure と揃える
 */
export class AiDisclosure {
  static readonly TEXT = "※画像はAIで生成したイメージです";
  static readonly SEPARATOR = "\n";
  static readonly NAME = "AI生成の表示";

  private constructor(private readonly required: boolean) {}

  /** 投稿の版から、表示が要るかを決める（写真風の生成画像を投稿画像か素材画像に1枚でも含むとき） */
  static of(revision: PostRevision): AiDisclosure {
    return new AiDisclosure(revision.requiresAiDisclosure());
  }

  /** 素材画像がまだ無く、写真風を含むか分からない生成の時点で、常に付く前提で文字数を見込むための表示（REQ-002 BR-002-16） */
  static assumingRequired(): AiDisclosure {
    return new AiDisclosure(true);
  }

  isRequired(): boolean {
    return this.required;
  }

  /** 公開用キャプションの末尾に付ける文字列（不要なら空） */
  suffix(): string {
    return this.required ? AiDisclosure.SEPARATOR + AiDisclosure.TEXT : "";
  }
}
