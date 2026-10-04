import { ImageStyle } from "./ImageStyle";

/** 生成画像: 採用されて投稿画像になった候補。どの画像生成の何番目か（1〜4）と、画像の種類を持つ */
export class GeneratedImage {
  static readonly MAX_POSITION = 4;

  private constructor(
    readonly generationId: string,
    readonly candidatePosition: number,
    readonly style: ImageStyle,
  ) {}

  static of(parts: { generationId: string; candidatePosition: number; styleCode: string }): GeneratedImage {
    if (parts.generationId === "") throw new Error("画像生成IDは必須です");
    if (!Number.isInteger(parts.candidatePosition) || parts.candidatePosition < 1 || parts.candidatePosition > GeneratedImage.MAX_POSITION) {
      throw new Error(`候補の位置は1〜${GeneratedImage.MAX_POSITION}です: ${parts.candidatePosition}`);
    }
    return new GeneratedImage(parts.generationId, parts.candidatePosition, ImageStyle.from(parts.styleCode));
  }

  requiresAiDisclosure(): boolean {
    return this.style.requiresAiDisclosure();
  }

  needsApprovalCheck(): boolean {
    return this.style.needsApprovalCheck();
  }
}
