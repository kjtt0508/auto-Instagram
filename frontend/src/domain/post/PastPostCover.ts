/**
 * 過去の投稿の表紙: 最後のスライドに載せる、過去に公開した投稿1件（投稿IDと、その投稿の投稿画像の1枚目）。
 * 公開済みの投稿で、載せる投稿自身ではない（REQ-002 BR-002-15）。選ぶのは承認の出来事（DB の approve_post）だけで、ここは値と不変条件だけを持つ。Java の PastPostCover と揃える
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
}
