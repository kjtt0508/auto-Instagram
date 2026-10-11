/**
 * アクセント色: 表紙の3段目の帯の色（7色。REQ-006）。紫・赤・青緑の値は新島info の公開中の投稿から読み取ったもの（REQ-002 設計 0章）で変えない。
 * 青・緑・オレンジ・ピンクは設計で決めた値（REQ-006 設計 2章。左端・右端とも白との明るさの比が 3:1 以上。テストで確かめる）。
 * 紫は単色、ほかは左→右のグラデーション。Java の AccentColor と揃える（docs/model/fixtures/accent-colors.json）
 */
export class AccentColor {
  static readonly PURPLE = new AccentColor("PURPLE", "紫", "#8C52FE", "#8C52FE");
  static readonly RED = new AccentColor("RED", "赤", "#FD3432", "#FE914C");
  static readonly TEAL = new AccentColor("TEAL", "青緑", "#19BBAA", "#066A85");
  static readonly BLUE = new AccentColor("BLUE", "青", "#3B82F6", "#1D4ED8");
  static readonly GREEN = new AccentColor("GREEN", "緑", "#1FA35C", "#0E7C45");
  static readonly ORANGE = new AccentColor("ORANGE", "オレンジ", "#E8590C", "#C2410C");
  static readonly PINK = new AccentColor("PINK", "ピンク", "#E5528B", "#C2185B");

  private constructor(
    readonly code: string,
    readonly label: string,
    /** 帯の左端の色 */
    readonly startColor: string,
    /** 帯の右端の色（単色なら左端と同じ） */
    readonly endColor: string,
  ) {}

  static all(): readonly AccentColor[] {
    return [AccentColor.PURPLE, AccentColor.RED, AccentColor.TEAL, AccentColor.BLUE, AccentColor.GREEN, AccentColor.ORANGE, AccentColor.PINK];
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
