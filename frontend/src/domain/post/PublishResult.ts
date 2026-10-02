/** 公開結果: 公開に成功したときに Instagram から得た情報。メディアIDと公開日時は必須 */
export class PublishResult {
  private constructor(
    readonly mediaId: string,
    readonly permalink: string,
    readonly publishedAt: Date,
  ) {}

  static of(mediaId: string, permalink: string, publishedAt: Date): PublishResult {
    if (mediaId.trim() === "") throw new Error("メディアIDは必須です");
    if (Number.isNaN(publishedAt.getTime())) throw new Error("公開日時は必須です");
    return new PublishResult(mediaId, permalink, publishedAt);
  }
}
