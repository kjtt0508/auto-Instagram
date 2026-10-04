/** ハッシュタグ: 「#」（全角「＃」も）で始まり空白を含まない分類語 */
export class Hashtag {
  private static readonly IN_TEXT = /[#＃][^\s#＃]+/gu;

  private constructor(readonly text: string) {}

  static of(text: string): Hashtag {
    const whole = new RegExp(`^${Hashtag.IN_TEXT.source}$`, "u");
    if (!whole.test(text)) throw new Error(`ハッシュタグは「#」で始まり空白を含みません: ${text}`);
    return new Hashtag(text);
  }

  /** ハッシュタグの形なら返し、そうでなければ undefined（AI の出力や人の入力を検査するとき、例外にせず違反として扱うため） */
  static parse(text: string): Hashtag | undefined {
    return new RegExp(`^${Hashtag.IN_TEXT.source}$`, "u").test(text) ? new Hashtag(text) : undefined;
  }

  /** 全角「＃」と半角「#」を同じものとして比べるための印 */
  sameAs(other: Hashtag): boolean {
    return this.normalized() === other.normalized();
  }

  private normalized(): string {
    return this.text.replace(/^＃/u, "#");
  }

  /** 文章に含まれるハッシュタグの数 */
  static countIn(text: string): number {
    return text.match(Hashtag.IN_TEXT)?.length ?? 0;
  }
}
