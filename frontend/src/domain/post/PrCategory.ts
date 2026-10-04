/** PR区分: 対価を受けた広告かどうか。PR案件は公開時にPR表記を先頭に付ける（ステマ規制への対応） */
export class PrCategory {
  static readonly NONE = new PrCategory("NONE", "通常", false);
  static readonly PR = new PrCategory("PR", "PR案件", true);

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly labelRequired: boolean,
  ) {}

  static all(): readonly PrCategory[] {
    return [PrCategory.NONE, PrCategory.PR];
  }

  static from(code: string): PrCategory {
    const found = PrCategory.all().find((c) => c.code === code);
    if (!found) throw new Error(`知らないPR区分です: ${code}`);
    return found;
  }

  requiresLabel(): boolean {
    return this.labelRequired;
  }

  /** 公開用キャプションの先頭に付ける表記（PR案件だけPR表記、通常は空） */
  labelPrefix(prLabel: string): string {
    return this.labelRequired ? prLabel : "";
  }
}
