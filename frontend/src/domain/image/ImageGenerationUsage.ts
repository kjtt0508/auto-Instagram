import type { ImageGenerationQuota } from "./ImageGenerationQuota";

/**
 * 画像生成の回数: 団体・日（日本時間 9:00 区切り）ごとの画像生成の回数（候補4枚で1回）。
 * 確保そのものは DB で原子的に行う（NFR-005-03）。ここは数えた結果をどう見せるかを判断する
 */
export class ImageGenerationUsage {
  private constructor(
    readonly used: number,
    readonly quota: ImageGenerationQuota,
  ) {}

  static of(used: number, quota: ImageGenerationQuota): ImageGenerationUsage {
    if (!Number.isInteger(used) || used < 0) throw new Error("画像生成の回数は0以上です");
    return new ImageGenerationUsage(used, quota);
  }

  canGenerate(): boolean {
    return !this.quota.isReached(this.used);
  }

  isNearLimit(): boolean {
    return this.quota.isNearLimit(this.used);
  }

  remaining(): number {
    return Math.max(0, this.quota.dailyLimit - this.used);
  }
}
