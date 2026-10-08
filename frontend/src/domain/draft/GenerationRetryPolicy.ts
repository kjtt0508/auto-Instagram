/**
 * 再生成方針: LLM の出力が下書き案の条件を満たさなかったとき、違反内容を添えて作り直してよいかの判断。
 * 1回の依頼につき作り直しは1回まで（REQ-002 BR-002-03）。残り時間の条件（20秒以上）は呼び出し側が確かめる
 */
export class GenerationRetryPolicy {
  static readonly MAX_RETRIES = 1;

  /** 作り直してよいか（違反があり、まだ作り直していない） */
  static canRetry(violations: readonly string[], retriesDone: number): boolean {
    return violations.length > 0 && retriesDone < GenerationRetryPolicy.MAX_RETRIES;
  }

  /** 作り直しのときに、元のプロンプトの後ろに足して LLM へ渡す違反の説明 */
  static correctionNote(violations: readonly string[]): string {
    return ["", "", "# 前回の出力の問題", "前回の出力は次の条件を満たしていませんでした。直して、指定した JSON だけをもう一度出力してください。",
      ...violations.map((v) => `- ${v}`)].join("\n");
  }
}
