import type { GeneratedImage } from "./GeneratedImage";

/** 投稿画像: 投稿に含まれる1枚の画像（順番・保存先・幅・高さ・容量）。生成画像なら、その由来（GeneratedImage）を持つ */
export class PostMedia {
  private constructor(
    readonly position: number,
    readonly storagePath: string,
    private readonly size: { width: number; height: number; bytes: number },
    readonly generated: GeneratedImage | null,
  ) {}

  static of(parts: {
    position: number; storagePath: string; width: number; height: number; bytes: number; generated?: GeneratedImage | null;
  }): PostMedia {
    if (!Number.isInteger(parts.position) || parts.position < 1) throw new Error(`順番は1以上です: ${parts.position}`);
    if (parts.storagePath.trim() === "") throw new Error("保存先は必須です");
    if (!(parts.width > 0 && parts.height > 0 && parts.bytes > 0)) throw new Error("幅・高さ・容量は正の数です");
    return new PostMedia(parts.position, parts.storagePath,
      { width: parts.width, height: parts.height, bytes: parts.bytes }, parts.generated ?? null);
  }

  /** 同じ画像を別の順番に置いたもの */
  movedTo(position: number): PostMedia {
    return PostMedia.of({ position, storagePath: this.storagePath, ...this.size, generated: this.generated });
  }

  aspectRatio(): number {
    return this.size.width / this.size.height;
  }

  widthWithin(min: number, max: number): boolean {
    return this.size.width >= min && this.size.width <= max;
  }

  bytesAtMost(max: number): boolean {
    return this.size.bytes <= max;
  }

  aspectWithin(min: number, max: number): boolean {
    return this.aspectRatio() >= min && this.aspectRatio() <= max;
  }

  sameAspectAs(other: PostMedia): boolean {
    return Math.abs(this.aspectRatio() - other.aspectRatio()) < 0.01;
  }

  /** 公開時にAI生成の表示が要る画像か（写真風の生成画像） */
  requiresAiDisclosure(): boolean {
    return this.generated?.requiresAiDisclosure() ?? false;
  }

  /** 承認時に確認を出す画像か（写真風の生成画像） */
  needsApprovalCheck(): boolean {
    return this.generated?.needsApprovalCheck() ?? false;
  }

  /** RPC save_post_revision に渡す形（REQ-001 設計 4章）。生成画像なら候補の参照を付ける（REQ-005: 版の保存と同時に候補の採用を記録） */
  toRevisionMedia() {
    const media = { position: this.position, storagePath: this.storagePath, width: this.size.width,
      height: this.size.height, byteSize: this.size.bytes };
    if (!this.generated) return media;
    return { ...media, generation: { generationId: this.generated.generationId, candidatePosition: this.generated.candidatePosition } };
  }
}
