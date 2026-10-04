/**
 * 画像の種類: 画像生成で作る画像の見た目の種類。種類ごとに開示と確認の扱いが変わる（REQ-005 BR-005-01 の表）
 *   背景・イラスト: 注意書き・承認時の確認・AI生成の表示・AI info をどれも出さない
 *   写真風: どれも出す（イメージ写真としてだけ使う。BR-005-09）
 */
export class ImageStyle {
  static readonly ILLUSTRATION = new ImageStyle("ILLUSTRATION", "背景・イラスト", false);
  static readonly PHOTOREALISTIC = new ImageStyle("PHOTOREALISTIC", "写真風", true);

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly realistic: boolean,
  ) {}

  static all(): readonly ImageStyle[] {
    return [ImageStyle.ILLUSTRATION, ImageStyle.PHOTOREALISTIC];
  }

  static from(code: string): ImageStyle {
    const found = ImageStyle.all().find((s) => s.code === code);
    if (!found) throw new Error(`知らない画像の種類です: ${code}`);
    return found;
  }

  /** 生成時に「イメージ写真としてだけ使えます」の注意書きを出すか（AC-005-09） */
  showsCaution(): boolean {
    return this.realistic;
  }

  /** 承認時に「写真風の生成画像を含みます」の確認を出すか（AC-005-08） */
  needsApprovalCheck(): boolean {
    return this.realistic;
  }

  /** 公開時にAI生成の表示（キャプション末尾・AI info）を付けるか（BR-005-05） */
  requiresAiDisclosure(): boolean {
    return this.realistic;
  }
}
