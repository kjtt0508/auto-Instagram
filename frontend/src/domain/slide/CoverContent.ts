import type { CoverText } from "./CoverText";

/**
 * 表紙の中身: 表紙の文言と背景写真（無ければ紺の単色）。背景写真は0〜1枚。
 * Java の CoverContent と揃える
 */
export class CoverContent {
  private constructor(
    readonly text: CoverText,
    readonly background: { photoId: string; storagePath: string } | undefined,
  ) {}

  static of(text: CoverText, background?: { photoId: string; storagePath: string }): CoverContent {
    return new CoverContent(text, background);
  }

  /** 背景写真を選び直した新しい中身 */
  withBackground(background: { photoId: string; storagePath: string }): CoverContent {
    return new CoverContent(this.text, background);
  }

  /** 紺の単色の背景にした新しい中身 */
  withoutBackground(): CoverContent {
    return new CoverContent(this.text, undefined);
  }

  /** 文言だけを差し替えた新しい中身（背景写真は保つ） */
  withText(text: CoverText): CoverContent {
    return new CoverContent(text, this.background);
  }

  /** 画像化に必要な画像の参照（背景写真の保存先） */
  imageRefs(): readonly string[] {
    return this.background ? [this.background.storagePath] : [];
  }

  requiresAiDisclosure(): boolean {
    return false;
  }

  needsApprovalCheck(): boolean {
    return false;
  }
}
