import { PastPostCover } from "../post/PastPostCover";

/**
 * 最後のスライドの中身: 過去の投稿の表紙0〜2件（定型文とアカウントの紹介は投稿の型の設定から取る。AI は書かない）。
 * 過去の投稿は承認の出来事で決まるので、投稿の版には持たせない。画像化のときに、承認で選んだものを受け取る（REQ-002 BR-002-15）。
 * Java の ClosingContent と揃える
 */
export class ClosingContent {
  private constructor(readonly pastPosts: readonly PastPostCover[]) {}

  /** 投稿の版が持つ姿（過去の投稿はまだ決まっていない） */
  static empty(): ClosingContent {
    return new ClosingContent([]);
  }

  /** 画像化のとき、承認で選んだ過去の投稿の表紙を受け取った中身 */
  static of(pastPosts: readonly PastPostCover[]): ClosingContent {
    if (pastPosts.length > PastPostCover.MAX_COUNT) throw new Error(`過去の投稿の表紙は${PastPostCover.MAX_COUNT}件までです`);
    return new ClosingContent([...pastPosts]);
  }

  imageRefs(): readonly string[] {
    return this.pastPosts.map((p) => p.coverStoragePath);
  }

  requiresAiDisclosure(): boolean {
    return false;
  }

  needsApprovalCheck(): boolean {
    return false;
  }
}
