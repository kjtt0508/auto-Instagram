/** LLM上限: 1日に使ってよいLLM呼び出し回数と、警告を出す割合（団体の設定値。既定の割合は0.8） */
export class LlmQuota {
  private constructor(
    readonly dailyLimit: number,
    readonly warnRatio: number,
  ) {}

  static of(dailyLimit: number, warnRatio: number): LlmQuota {
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1) throw new Error("LLM上限は1以上です");
    if (!(warnRatio > 0 && warnRatio <= 1)) throw new Error("警告の割合は0より大きく1以下です");
    return new LlmQuota(dailyLimit, warnRatio);
  }

  /** この回数を使っていたら上限が近い */
  isNearLimit(used: number): boolean {
    return used >= this.dailyLimit * this.warnRatio;
  }
}
