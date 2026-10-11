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

  /**
   * 下書き案の文言を取り込んだ新しい中身（修正指示の再生成。REQ-002 BR-002-04）。
   * 背景写真と、人が選んだ帯の色（アクセント色）は保つ。AI が別の色を返しても上書きしない（REQ-006 BR-006-01・AC-006-02）
   */
  withDraftText(text: CoverText): CoverContent {
    return new CoverContent(text.withAccent(this.text.accent), this.background);
  }

  /** 画像化に必要な画像の参照（背景写真の保存先） */
  imageRefs(): readonly string[] {
    return this.background ? [this.background.storagePath] : [];
  }

  /** 保存（RPC save_post_revision）に渡す表紙の形（強調・素材は無い） */
  toStoredForm() {
    const { target, keyword, annotation, closingWords, accent } = this.text;
    return { role: "COVER" as const, target, keyword, annotation, closingWords, accent: accent.code,
      backgroundPhotoId: this.background?.photoId ?? null };
  }

  /** テンプレートの描画値（表紙。画像は保存先を参照名にする） */
  renderValues() {
    const { target, keyword, annotation, closingWords, accent } = this.text;
    return { role: "COVER" as const, target, keyword, annotation, closingWords,
      accentStart: accent.startColor, accentEnd: accent.endColor, background: this.background?.storagePath };
  }

  requiresAiDisclosure(): boolean {
    return false;
  }

  needsApprovalCheck(): boolean {
    return false;
  }
}
