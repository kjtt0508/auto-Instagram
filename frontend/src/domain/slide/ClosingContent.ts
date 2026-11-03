import type { ClosingImageList } from "../post/ClosingImageList";
import type { PastPostCover } from "../post/PastPostCover";

/**
 * 最後のスライドの中身: 真ん中に並べる画像0〜2枚の参照（定型文とアカウントの紹介は投稿の型の設定から取る。AI は書かない）。
 * 並べる画像は、投稿の型の設定の版の最後のスライドの画像（REQ-007）。REQ-007 より前の承認で過去の投稿の表紙を記録していれば、その表紙。
 * 投稿の版には持たせず、プレビュー（編集の画面は最新の設定の版、承認の画面・投稿の表示は投稿の版が記録した設定の版）と画像化のときに受け取る。
 * テンプレート niijima@1 の差し込みの名前は pastPosts のままで、中身は「並べる画像の参照」（niijima@2 を作るときに名前を直す）。Java の ClosingContent と揃える
 */
export class ClosingContent {
  /** 並べる画像の上限（niijima@1 の枠の数）。最後のスライドの画像一覧・過去の投稿の表紙はこれを参照する */
  static readonly MAX_IMAGES = 2;

  private constructor(private readonly refs: readonly string[]) {}

  /** 投稿の版が持つ姿（並べる画像はまだ決まっていない） */
  static empty(): ClosingContent {
    return new ClosingContent([]);
  }

  /** 最後のスライドの画像一覧から作る（プレビュー・画像化） */
  static fromClosingImages(closingImages: ClosingImageList): ClosingContent {
    return ClosingContent.of(closingImages.refs());
  }

  /**
   * 承認の記録から作る。過去の投稿の表紙を記録していればその表紙、無ければ設定の版の最後のスライドの画像（BR-007-05）。
   * 混ぜない。記録が0件で画像なしになるのは、REQ-007 より前の設定の版に最後のスライドの画像が無いことによる
   */
  static fromApproval(pastPosts: readonly PastPostCover[], closingImages: ClosingImageList): ClosingContent {
    if (pastPosts.length > 0) return ClosingContent.of(pastPosts.map((p) => p.coverStoragePath));
    return ClosingContent.fromClosingImages(closingImages);
  }

  private static of(refs: readonly string[]): ClosingContent {
    if (refs.length > ClosingContent.MAX_IMAGES) throw new Error(`最後のスライドに並べる画像は${ClosingContent.MAX_IMAGES}枚までです`);
    return new ClosingContent([...refs]);
  }

  /** 保存に渡す最後のスライドの形（並べる画像は設定・承認で決まるので持たない） */
  toStoredForm() {
    return { role: "CLOSING" as const };
  }

  /** テンプレートの描画値（最後のスライド）。pastPosts は並べる画像の参照（niijima@1 の差し込みの名前） */
  renderValues() {
    return { role: "CLOSING" as const, pastPosts: [...this.refs] };
  }

  imageRefs(): readonly string[] {
    return this.refs;
  }

  requiresAiDisclosure(): boolean {
    return false;
  }

  needsApprovalCheck(): boolean {
    return false;
  }
}
