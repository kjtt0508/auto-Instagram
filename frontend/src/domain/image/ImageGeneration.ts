import type { ImageStyle } from "../post/ImageStyle";
import { ImageCandidate } from "./ImageCandidate";
import type { ImagePrompt } from "./ImagePrompt";

/**
 * 画像生成: 指示から候補を作った1回の出来事（REQ-005）。英訳できたときだけ生まれる（英訳できなければ記録しない）。
 * 作れた候補の数から結果（1枚以上=成功、0枚=失敗）を決める
 */
export class ImageGeneration {
  static readonly CANDIDATES_PER_GENERATION = 4;

  private constructor(
    readonly id: string,
    readonly style: ImageStyle,
    readonly prompt: ImagePrompt,
    readonly translatedPrompt: string,
    readonly candidateCount: number,
  ) {}

  /** 英訳できた指示で、候補を作った結果を表す */
  static of(parts: { id: string; style: ImageStyle; prompt: ImagePrompt; translatedPrompt: string; candidateCount: number }): ImageGeneration {
    if (parts.id === "") throw new Error("画像生成IDは必須です");
    if (parts.translatedPrompt.trim() === "") throw new Error("英訳した指示が無い画像生成は記録しません");
    if (!Number.isInteger(parts.candidateCount) || parts.candidateCount < 0 || parts.candidateCount > ImageGeneration.CANDIDATES_PER_GENERATION) {
      throw new Error(`候補の数は0〜${ImageGeneration.CANDIDATES_PER_GENERATION}です`);
    }
    return new ImageGeneration(parts.id, parts.style, parts.prompt, parts.translatedPrompt.trim(), parts.candidateCount);
  }

  isSucceeded(): boolean {
    return this.candidateCount >= 1;
  }

  /** 記録する結果（DB の outcome） */
  outcome(): "SUCCEEDED" | "FAILED" {
    return this.isSucceeded() ? "SUCCEEDED" : "FAILED";
  }

  /** 作れた候補（位置 1 から） */
  candidates(): ImageCandidate[] {
    return Array.from({ length: this.candidateCount },
      (_, i) => ImageCandidate.of({ generationId: this.id, position: i + 1, style: this.style }));
  }
}
