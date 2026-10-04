/**
 * 過去の投稿の表紙: 最後のスライドに載せる、過去に公開した投稿1件（投稿IDと、その投稿の投稿画像の1枚目）。
 * 公開済みの投稿で、載せる投稿自身ではない（REQ-002 BR-002-15）。Java の PastPostCover と揃える
 */
export class PastPostCover {
  /** 最後のスライドに載せる最大件数 */
  static readonly MAX_COUNT = 2;

  private constructor(readonly postId: string, readonly coverStoragePath: string) {}

  static of(postId: string, coverStoragePath: string, ownPostId: string): PastPostCover {
    if (postId === "" || coverStoragePath.trim() === "") throw new Error("投稿IDと表紙の保存先は必須です");
    if (postId === ownPostId) throw new Error("投稿自身の表紙は載せられません");
    return new PastPostCover(postId, coverStoragePath);
  }

  /**
   * 承認した時点で公開済みの投稿（published）から、公開日時が新しい順に最大2件を選ぶ。承認する投稿自身は除く（0〜2件。AC-002-15）
   */
  static createLatest(ownPostId: string, published: readonly { postId: string; coverStoragePath: string; publishedAt: Date }[]): PastPostCover[] {
    return published
      .filter((p) => p.postId !== ownPostId)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
      .slice(0, PastPostCover.MAX_COUNT)
      .map((p) => PastPostCover.of(p.postId, p.coverStoragePath, ownPostId));
  }
}
