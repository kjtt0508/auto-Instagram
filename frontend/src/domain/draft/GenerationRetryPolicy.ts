/**
 * 再生成方針: LLM の出力が下書き案の条件を満たさなかったとき、違反内容を添えて作り直してよいかの判断。
 * 作り直してよいのは、違反があり、まだ作り直しておらず、依頼の制限時間（60秒）に20秒以上残っているとき。
 * 1回の依頼につき作り直しは1回まで（REQ-002 BR-002-03）
 */
export class GenerationRetryPolicy {
  static readonly MAX_RETRIES = 1;
  /** 1回の依頼の制限時間（ミリ秒）。画面の待ち時間とサーバーレス関数の上限に収める */
  static readonly TOTAL_TIMEOUT_MS = 60_000;
  /** 作り直しを始めるのに必要な残り時間（ミリ秒） */
  static readonly MIN_RETRY_REMAINING_MS = 20_000;

  /** 依頼の開始から elapsedMs 経ったときの残り時間（ミリ秒。負にはならない） */
  static remainingMs(elapsedMs: number): number {
    return Math.max(0, GenerationRetryPolicy.TOTAL_TIMEOUT_MS - elapsedMs);
  }

  /** 作り直してよいか（違反があり、まだ作り直しておらず、残り時間が足りる） */
  static canRetry(violations: readonly string[], retriesDone: number, remainingMs: number): boolean {
    return violations.length > 0
      && retriesDone < GenerationRetryPolicy.MAX_RETRIES
      && remainingMs >= GenerationRetryPolicy.MIN_RETRY_REMAINING_MS;
  }

  /** 作り直しのときに、元のプロンプトの後ろに足して LLM へ渡す違反の説明 */
  static correctionNote(violations: readonly string[]): string {
    return ["", "", "# 前回の出力の問題", "前回の出力は次の条件を満たしていませんでした。直して、指定した JSON だけをもう一度出力してください。",
      ...violations.map((v) => `- ${v}`)].join("\n");
  }
}
