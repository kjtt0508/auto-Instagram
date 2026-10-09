import type { GeneratedImage } from "../post/GeneratedImage";

/**
 * 素材画像: 中のスライドのカードに載せる画像。生成画像（候補を採用したもの）か、人が差し替えた画像のどちらか一方。
 * 人が差し替えた画像は生成画像ではない（AI生成の表示は付かない。REQ-002 BR-002-20）。Java の MaterialImage と揃える
 */
export class MaterialImage {
  private constructor(
    readonly storagePath: string,
    private readonly size: { width: number; height: number },
    private readonly generated: GeneratedImage | undefined,
  ) {}

  /** generated を渡すと生成画像、渡さなければ人が差し替えた画像 */
  static of(parts: { storagePath: string; width: number; height: number; generated?: GeneratedImage }): MaterialImage {
    if (parts.storagePath.trim() === "") throw new Error("保存先は必須です");
    if (!(parts.width > 0 && parts.height > 0)) throw new Error("幅・高さは正の数です");
    return new MaterialImage(parts.storagePath, { width: parts.width, height: parts.height }, parts.generated);
  }

  /** 生成画像の由来（人が差し替えた画像なら undefined）。端末への一時保存が使う */
  generatedImage(): GeneratedImage | undefined {
    return this.generated;
  }

  dimensions(): { width: number; height: number } {
    return this.size;
  }

  isGenerated(): boolean {
    return this.generated !== undefined;
  }

  /** 公開時にAI生成の表示が要る画像か（写真風の生成画像のときだけ） */
  requiresAiDisclosure(): boolean {
    return this.generated?.requiresAiDisclosure() ?? false;
  }

  /** 承認時に「写真風の生成画像を含みます」の確認を出す画像か */
  needsApprovalCheck(): boolean {
    return this.generated?.needsApprovalCheck() ?? false;
  }

  /** 保存（RPC save_post_revision）に渡す形。生成画像なら候補の参照を付ける（素材画像としての採用） */
  toStoredForm() {
    const stored = { storagePath: this.storagePath, width: this.size.width, height: this.size.height };
    if (!this.generated) return stored;
    return { ...stored, generation: { generationId: this.generated.generationId, candidatePosition: this.generated.candidatePosition } };
  }
}
