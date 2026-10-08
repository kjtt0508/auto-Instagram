import type { LlmQuota } from "./LlmQuota";

/**
 * LLM利用回数: 団体・日付・モデルごとのLLM呼び出し回数。確保そのものは DB が原子的に行う（上限を超えさせない）。
 * ここは確保できた結果を、利用者にどう見せるかを判断する
 */
export class LlmUsage {
  private constructor(
    readonly used: number,
    readonly quota: LlmQuota,
  ) {}

  /** 1回分を確保した直後の回数（確保を含む）から作る */
  static reserved(used: number, quota: LlmQuota): LlmUsage {
    if (!Number.isInteger(used) || used < 1) throw new Error("確保した直後の回数は1以上です");
    return new LlmUsage(used, quota);
  }

  /**
   * 上限が近い警告を出すか。確保する前に使っていた回数が8割以上のとき
   * （上限100回・割合0.8なら、79回使用済みで生成するときは警告なし、80回使用済みから警告。REQ-002 AC-002-06）
   */
  shouldWarn(): boolean {
    return this.quota.isNearLimit(this.used - 1);
  }
}
