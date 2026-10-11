/**
 * 背景写真の出どころ: 背景写真が、管理者の登録によるものか、AI が作った背景かの区分（REQ-006）。
 * 列に持たず、背景写真としての採用の記録があるかどうかから導く（DB のビュー usable_background_photos.generated。P31）。
 * AI が作った背景でも、AI生成の表示は要らない（背景・イラストだけを作る。REQ-005 BR-005-01）
 */
export class BackgroundPhotoOrigin {
  static readonly REGISTERED = new BackgroundPhotoOrigin("REGISTERED", "管理者の登録", false);
  static readonly GENERATED = new BackgroundPhotoOrigin("GENERATED", "AIが作った背景", true);

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly generated: boolean,
  ) {}

  static all(): readonly BackgroundPhotoOrigin[] {
    return [BackgroundPhotoOrigin.REGISTERED, BackgroundPhotoOrigin.GENERATED];
  }

  static from(code: string): BackgroundPhotoOrigin {
    const found = BackgroundPhotoOrigin.all().find((o) => o.code === code);
    if (!found) throw new Error(`知らない背景写真の出どころです: ${code}`);
    return found;
  }

  /** 背景写真としての採用の記録があるか（DB が導いた値）から出どころを決める */
  static ofAdoption(hasAdoptionRecord: boolean): BackgroundPhotoOrigin {
    return hasAdoptionRecord ? BackgroundPhotoOrigin.GENERATED : BackgroundPhotoOrigin.REGISTERED;
  }

  /** AI が作った背景か（元の画像生成を持つか） */
  isGenerated(): boolean {
    return this.generated;
  }
}
