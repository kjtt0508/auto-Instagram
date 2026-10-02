/** ハッシュタグ: 「#」（全角「＃」も）で始まり空白を含まない分類語 */
export class Hashtag {
  private static readonly IN_TEXT = /[#＃][^\s#＃]+/gu;

  private constructor(readonly text: string) {}

  static of(text: string): Hashtag {
    const whole = new RegExp(`^${Hashtag.IN_TEXT.source}$`, "u");
    if (!whole.test(text)) throw new Error(`ハッシュタグは「#」で始まり空白を含みません: ${text}`);
    return new Hashtag(text);
  }

  /** 文章に含まれるハッシュタグの数 */
  static countIn(text: string): number {
    return text.match(Hashtag.IN_TEXT)?.length ?? 0;
  }
}
