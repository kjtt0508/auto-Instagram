/**
 * 過去の投稿の表紙: REQ-007 より前の承認で、最後のスライドに載せるために選んだ過去の投稿1件（投稿IDと、その投稿の表紙の保存先）。
 * REQ-007 で承認のときに選ぶことはやめた。記録した承認の画像化・表示のために、記録から戻すだけ残す（新しくは作らない。BR-007-05）。
 * Java の PastPostCover と揃える
 */
export class PastPostCover {
  private constructor(readonly postId: string, readonly coverStoragePath: string) {}

  /** 承認の記録から戻す */
  static restore(postId: string, coverStoragePath: string): PastPostCover {
    if (postId === "" || coverStoragePath.trim() === "") throw new Error("投稿IDと表紙の保存先は必須です");
    return new PastPostCover(postId, coverStoragePath);
  }
}
