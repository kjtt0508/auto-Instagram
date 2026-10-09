import type { MaterialImage } from "./MaterialImage";
import type { PictureBrief } from "./PictureBrief";
import type { SlideText } from "./SlideText";

/**
 * 中のスライドの中身: スライドの文言・絵の指示・素材画像（無くてよい。無ければ文字だけのカード）。素材画像は0〜1枚。
 * Java の BodyContent と揃える
 */
export class BodyContent {
  private constructor(
    readonly text: SlideText,
    readonly brief: PictureBrief,
    readonly material: MaterialImage | undefined,
  ) {}

  static of(parts: { text: SlideText; brief: PictureBrief; material?: MaterialImage }): BodyContent {
    return new BodyContent(parts.text, parts.brief, parts.material);
  }

  /** 素材画像を差し替えた・作った新しい中身 */
  withMaterial(material: MaterialImage): BodyContent {
    return new BodyContent(this.text, this.brief, material);
  }

  /** 素材画像を外した（文字だけのカードにした）新しい中身 */
  withoutMaterial(): BodyContent {
    return new BodyContent(this.text, this.brief, undefined);
  }

  /** 文言と絵の指示を差し替えた新しい中身（作成済みの素材画像は保つ。修正指示の再生成。REQ-002 BR-002-04） */
  withDraftText(text: SlideText, brief: PictureBrief): BodyContent {
    return new BodyContent(text, brief, this.material);
  }

  /** 保存（RPC save_post_revision）に渡す中のスライドの形。強調する語は説明文の中の位置（コードポイント）にして渡す */
  toStoredForm() {
    return {
      role: "BODY" as const, heading: this.text.heading, description: this.text.description,
      emphases: this.text.emphasisRanges(), picturePrompt: this.brief.promptText(), needsReplacement: this.brief.needsReplacement(),
      ...(this.material ? { material: this.material.toStoredForm() } : {}),
    };
  }

  /** テンプレートの描画値（中のスライド。強調する部分は区切りにして渡す） */
  renderValues() {
    return { role: "BODY" as const, heading: this.text.heading, segments: this.text.segments(), material: this.material?.storagePath };
  }

  imageRefs(): readonly string[] {
    return this.material ? [this.material.storagePath] : [];
  }

  /** 写真風の生成画像を含むか（素材画像に委ねる） */
  requiresAiDisclosure(): boolean {
    return this.material?.requiresAiDisclosure() ?? false;
  }

  needsApprovalCheck(): boolean {
    return this.material?.needsApprovalCheck() ?? false;
  }
}
