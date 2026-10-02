import { Caption } from "./Caption";

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

  /** 公開用キャプションを作る（PR案件だけPR表記を付ける）。上限を超えるなら例外 */
  applyLabel(caption: Caption, prLabel: string): Caption {
    if (!this.labelRequired) return caption;
    return caption.prefixed(prLabel);
  }

  /** PR表記を付けると上限を超えるときの説明（空なら公開できる） */
  violationsWithLabel(caption: Caption, prLabel: string): string[] {
    if (!this.labelRequired || caption.fitsWhenPrefixed(prLabel)) return [];
    const length = caption.lengthWhenPrefixed(prLabel).toLocaleString("ja-JP");
    const max = Caption.MAX_LENGTH.toLocaleString("ja-JP");
    return [`PR表記を含めて${max}文字以内にしてください（${length}文字）`];
  }
}
