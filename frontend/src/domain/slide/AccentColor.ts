/**
 * アクセント色: 表紙の3段目の帯の色（紫・赤・青緑の3つだけ）。色の値は新島info の公開中の投稿から読み取ったもの
 * （REQ-002 設計 0章）。赤と青緑は左→右のグラデーション、紫は単色。Java の AccentColor と揃える
 */
export class AccentColor {
  static readonly PURPLE = new AccentColor("PURPLE", "紫", "#8C52FE", "#8C52FE");
  static readonly RED = new AccentColor("RED", "赤", "#FD3432", "#FE914C");
  static readonly TEAL = new AccentColor("TEAL", "青緑", "#19BBAA", "#066A85");

  private constructor(
    readonly code: string,
    readonly label: string,
    /** 帯の左端の色 */
    readonly startColor: string,
    /** 帯の右端の色（単色なら左端と同じ） */
    readonly endColor: string,
  ) {}

  static all(): readonly AccentColor[] {
    return [AccentColor.PURPLE, AccentColor.RED, AccentColor.TEAL];
  }

  static from(code: string): AccentColor {
    const found = AccentColor.all().find((c) => c.code === code);
    if (!found) throw new Error(`知らないアクセント色です: ${code}`);
    return found;
  }

  /** 帯の背景に使う CSS（単色ならその色、グラデーションなら左→右） */
  cssBackground(): string {
    return this.startColor === this.endColor ? this.startColor : `linear-gradient(to right, ${this.startColor}, ${this.endColor})`;
  }
}
