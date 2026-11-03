import { ClosingContent } from "../slide/ClosingContent";
import { ClosingImage } from "./ClosingImage";

/**
 * 最後のスライドの画像一覧: 投稿の型の設定の1つの版が持つ、最後のスライドの画像の並び（REQ-007）。並びの中の位置が順（1枚目が左）。
 * 0〜ClosingContent.MAX_IMAGES 枚で、同じ保存先を重ねない。値なので、足す・選び直す・外すは新しい一覧を返す。
 * 外しても選び直しても、もとの画像を Storage から消さない（古い版の設定と、それを使った投稿が使い続ける。BR-007-06）。Java の ClosingImageList と揃える
 */
export class ClosingImageList {
  private constructor(private readonly list: readonly ClosingImage[]) {}

  static empty(): ClosingImageList {
    return new ClosingImageList([]);
  }

  /** 並べる順の保存先から作る（記録から戻す・画面の編集中の姿） */
  static restore(storagePaths: readonly string[]): ClosingImageList {
    if (storagePaths.length > ClosingContent.MAX_IMAGES) {
      throw new Error(`最後のスライドの画像は${ClosingContent.MAX_IMAGES}枚までです`);
    }
    if (new Set(storagePaths).size !== storagePaths.length) throw new Error("同じ画像を最後のスライドに重ねられません");
    return new ClosingImageList(storagePaths.map((p) => ClosingImage.restore(p)));
  }

  canAdd(): boolean {
    return this.list.length < ClosingContent.MAX_IMAGES;
  }

  /** 後ろに足した新しい一覧（上限なら例外） */
  add(image: ClosingImage): ClosingImageList {
    if (!this.canAdd()) throw new Error(`最後のスライドの画像は${ClosingContent.MAX_IMAGES}枚までです`);
    return ClosingImageList.restore([...this.refs(), image.storagePath]);
  }

  /** 位置（0始まり）の画像を、その位置のまま差し替えた新しい一覧 */
  replace(index: number, image: ClosingImage): ClosingImageList {
    this.requireIndex(index);
    return ClosingImageList.restore(this.refs().map((p, i) => (i === index ? image.storagePath : p)));
  }

  /** 位置（0始まり）の画像を外し、後ろの画像を前に詰めた新しい一覧 */
  remove(index: number): ClosingImageList {
    this.requireIndex(index);
    return new ClosingImageList(this.list.filter((_, i) => i !== index));
  }

  count(): number {
    return this.list.length;
  }

  /** 並べる順の画像の参照（保存先） */
  refs(): readonly string[] {
    return this.list.map((image) => image.storagePath);
  }

  private requireIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.list.length) throw new Error(`${index + 1}枚目の画像はありません`);
  }
}
