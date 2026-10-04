/**
 * 画像生成の指示: 作ってほしい画像を言葉で表したもの（日本語、1〜500文字。REQ-005 BR-005-03, 06）。
 * 個人を特定できる情報（メールアドレス・電話番号の形式）は含めない。提供元へは英訳して渡す
 */
export class ImagePrompt {
  static readonly MAX_LENGTH = 500;
  private static readonly EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
  /** 0 または +81 で始まる 10〜11 桁（区切りの - や空白を許す）。前後に数字が続くもの（1000000円 など）は電話番号ではない */
  private static readonly PHONE = /(?<!\d)(?:\+81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}(?!\d)/u;

  private constructor(readonly text: string) {}

  /** 生成できない理由（空なら生成できる） */
  static violationsOf(text: string): string[] {
    const length = [...text.trim()].length;
    if (length < 1 || length > ImagePrompt.MAX_LENGTH) return [`指示は1〜${ImagePrompt.MAX_LENGTH}文字です`];
    if (ImagePrompt.containsPersonalInfo(text)) return ["個人を特定できる情報は指示に含められません"];
    return [];
  }

  /** 全角の数字・記号（０９０－…、＠）も、半角に寄せて（NFKC）から判定する */
  private static containsPersonalInfo(text: string): boolean {
    const normalized = text.normalize("NFKC").replace(/[‐－―−]/gu, "-");
    return ImagePrompt.EMAIL.test(normalized) || ImagePrompt.PHONE.test(normalized);
  }

  static of(text: string): ImagePrompt {
    const violations = ImagePrompt.violationsOf(text);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new ImagePrompt(text.trim());
  }
}
