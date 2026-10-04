import type { ImageSpec } from "./ImageSpec";
import { PostFormat } from "./PostFormat";
import { PostMedia } from "./PostMedia";

/** 投稿画像一覧: 順番が1から連番。カルーセルでは全画像が1枚目と同じ縦横比 */
export class PostMediaList {
  private constructor(private readonly media: readonly PostMedia[]) {}

  static of(media: readonly PostMedia[]): PostMediaList {
    const sorted = [...media].sort((a, b) => a.position - b.position);
    if (!sorted.every((m, i) => m.position === i + 1)) throw new Error("投稿画像の順番は1から連番です");
    return new PostMediaList(sorted);
  }

  static empty(): PostMediaList {
    return new PostMediaList([]);
  }

  count(): number {
    return this.media.length;
  }

  items(): readonly PostMedia[] {
    return this.media;
  }

  /** 写真風の生成画像を1枚でも含むか（公開時にAI生成の表示を付ける。REQ-005 BR-005-05） */
  requiresAiDisclosure(): boolean {
    return this.media.some((m) => m.requiresAiDisclosure());
  }

  /** 承認時に「写真風の生成画像を含みます」の確認を出すか（AC-005-08） */
  needsApprovalCheck(): boolean {
    return this.media.some((m) => m.needsApprovalCheck());
  }

  /** 枚数に合う投稿種別（1枚なら画像、2枚以上ならカルーセル） */
  format(): PostFormat {
    return PostFormat.forMediaCount(this.count());
  }

  /** あと何枚追加できるか */
  remainingSlots(): number {
    return Math.max(0, PostFormat.maxMediaPerPost() - this.count());
  }

  /** 2枚目以降をそろえる縦横比（1枚目の比率）。1枚も無ければ null */
  firstAspect(): number | null {
    return this.media[0]?.aspectRatio() ?? null;
  }

  /** 末尾に足した新しい一覧 */
  appended(media: PostMedia): PostMediaList {
    return PostMediaList.of([...this.media, media.movedTo(this.count() + 1)]);
  }

  /** 画像の順番（position）の位置に差し込み、後ろを1つずつずらした新しい一覧 */
  inserted(media: PostMedia): PostMediaList {
    const index = Math.min(Math.max(media.position, 1), this.count() + 1) - 1;
    return PostMediaList.renumbered([...this.media.slice(0, index), media, ...this.media.slice(index)]);
  }

  /** 指定した順番の画像を除き、詰め直した新しい一覧 */
  without(position: number): PostMediaList {
    return PostMediaList.renumbered(this.media.filter((m) => m.position !== position));
  }

  /** 指定した順番の画像を1つ前に出した新しい一覧 */
  movedForward(position: number): PostMediaList {
    if (position <= 1 || position > this.count()) return this;
    const reordered = [...this.media];
    [reordered[position - 2], reordered[position - 1]] = [reordered[position - 1], reordered[position - 2]];
    return PostMediaList.renumbered(reordered);
  }

  /** 投稿種別とあわせて、公開できない理由を列挙する（空なら公開できる） */
  violationsFor(format: PostFormat, spec: ImageSpec): string[] {
    const violations: string[] = [];
    if (!format.acceptsMediaCount(this.count())) violations.push(format.mediaCountRule());
    this.media.forEach((m) => spec.violationsOf(m).forEach((v) => violations.push(`${m.position}枚目: ${v}`)));
    if (!this.allSameAspect()) violations.push("カルーセルの画像は1枚目と同じ縦横比にそろえてください");
    return violations;
  }

  private allSameAspect(): boolean {
    const first = this.media[0];
    return !first || this.media.every((m) => first.sameAspectAs(m));
  }

  private static renumbered(media: readonly PostMedia[]): PostMediaList {
    return new PostMediaList(media.map((m, i) => m.movedTo(i + 1)));
  }
}
