/** 投稿画像: 投稿に含まれる1枚の画像（順番・保存先・幅・高さ・容量） */
export class PostMedia {
  private constructor(
    readonly position: number,
    readonly storagePath: string,
    private readonly size: { width: number; height: number; bytes: number },
  ) {}

  static of(parts: { position: number; storagePath: string; width: number; height: number; bytes: number }): PostMedia {
    if (!Number.isInteger(parts.position) || parts.position < 1) throw new Error(`順番は1以上です: ${parts.position}`);
    if (parts.storagePath.trim() === "") throw new Error("保存先は必須です");
    if (!(parts.width > 0 && parts.height > 0 && parts.bytes > 0)) throw new Error("幅・高さ・容量は正の数です");
    return new PostMedia(parts.position, parts.storagePath, { width: parts.width, height: parts.height, bytes: parts.bytes });
  }

  /** 同じ画像を別の順番に置いたもの */
  movedTo(position: number): PostMedia {
    return PostMedia.of({ position, storagePath: this.storagePath, ...this.size });
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

  /** RPC save_post_revision に渡す形（REQ-001 設計 4章） */
  toRevisionMedia() {
    return { position: this.position, storagePath: this.storagePath, width: this.size.width,
      height: this.size.height, byteSize: this.size.bytes };
  }
}
