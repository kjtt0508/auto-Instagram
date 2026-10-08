/** 生成経路: 下書き案をどうやって得たか（Gemini API か、人が外部のAIに貼って取り込む手動コピペか） */
export class GenerationRoute {
  static readonly API = new GenerationRoute("API", "Gemini API", true);
  static readonly MANUAL = new GenerationRoute("MANUAL", "手動コピペ", false);

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly counted: boolean,
  ) {}

  static all(): readonly GenerationRoute[] {
    return [GenerationRoute.API, GenerationRoute.MANUAL];
  }

  /** LLM利用回数を数えるか（API のみ） */
  countsLlmUsage(): boolean {
    return this.counted;
  }
}
