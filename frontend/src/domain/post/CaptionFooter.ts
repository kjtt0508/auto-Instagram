/**
 * キャプションの定型: キャプションの本文の後ろに毎回付ける締めの文（区切り線・団体の名乗り・アカウントの紹介など）。
 * 団体の設定値（投稿の型の設定）で、AI は書き換えない。Java の CaptionFooter と揃える
 */
export class CaptionFooter {
  private constructor(readonly text: string) {}

  static of(text: string): CaptionFooter {
    if (text.trim() === "") throw new Error("キャプションの定型は空にできません");
    return new CaptionFooter(text);
  }

  /** コードポイントで数えた文字数 */
  length(): number {
    return [...this.text].length;
  }
}
