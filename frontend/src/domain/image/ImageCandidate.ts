import { GeneratedImage } from "../post/GeneratedImage";
import type { ImageStyle } from "../post/ImageStyle";

/** 候補: 画像生成で作られ、まだ採用されていない画像（何番目か 1〜4）。採用されると生成画像になる */
export class ImageCandidate {
  private constructor(
    readonly generationId: string,
    readonly position: number,
    readonly style: ImageStyle,
  ) {}

  static of(parts: { generationId: string; position: number; style: ImageStyle }): ImageCandidate {
    if (parts.generationId === "") throw new Error("画像生成IDは必須です");
    if (!Number.isInteger(parts.position) || parts.position < 1 || parts.position > GeneratedImage.MAX_POSITION) {
      throw new Error(`候補の位置は1〜${GeneratedImage.MAX_POSITION}です: ${parts.position}`);
    }
    return new ImageCandidate(parts.generationId, parts.position, parts.style);
  }

  /** 採用されて生成画像になる */
  adopted(): GeneratedImage {
    return GeneratedImage.of({ generationId: this.generationId, candidatePosition: this.position, styleCode: this.style.code });
  }
}
