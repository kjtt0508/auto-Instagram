/** 画像生成の上限: 1日に画像生成してよい回数と、警告を出す割合（団体の設定値。仮置き 20回・0.8。REQ-005 BR-005-07） */
export class ImageGenerationQuota {
  private constructor(
    readonly dailyLimit: number,
    private readonly warnRatio: number,
  ) {}

  static of(dailyLimit: number, warnRatio: number): ImageGenerationQuota {
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1) throw new Error("画像生成の上限は1以上です");
    if (!(warnRatio > 0 && warnRatio <= 1)) throw new Error("警告の割合は0より大きく1以下です");
    return new ImageGenerationQuota(dailyLimit, warnRatio);
  }

  /** この回数に達したら上限が近い（8割） */
  isNearLimit(used: number): boolean {
    return used >= this.dailyLimit * this.warnRatio;
  }

  isReached(used: number): boolean {
    return used >= this.dailyLimit;
  }
}
