/** 投稿種別。投稿画像の枚数範囲が変わる（画像=1枚、カルーセル=2〜10枚） */
export class PostFormat {
  static readonly FEED_IMAGE = new PostFormat("FEED_IMAGE", "画像", 1, 1);
  static readonly CAROUSEL = new PostFormat("CAROUSEL", "カルーセル", 2, 10);

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly minMedia: number,
    private readonly maxMedia: number,
  ) {}

  static all(): readonly PostFormat[] {
    return [PostFormat.FEED_IMAGE, PostFormat.CAROUSEL];
  }

  static from(code: string): PostFormat {
    const found = PostFormat.all().find((f) => f.code === code);
    if (!found) throw new Error(`知らない投稿種別です: ${code}`);
    return found;
  }

  acceptsMediaCount(count: number): boolean {
    return count >= this.minMedia && count <= this.maxMedia;
  }

  /** 枚数の決まりの説明（違反時に表示する） */
  mediaCountRule(): string {
    if (this.minMedia === this.maxMedia) return `画像は${this.minMedia}枚です`;
    return `カルーセルは${this.minMedia}〜${this.maxMedia}枚です`;
  }

  /** あと何枚追加できるか（画像の選択画面で使う） */
  remainingSlots(currentCount: number): number {
    return Math.max(0, this.maxMedia - currentCount);
  }

  /** 2枚目以降を1枚目の縦横比にそろえるか */
  alignsAspectToFirst(): boolean {
    return this.maxMedia > 1;
  }
}
