import { ImageSpec } from "./ImageSpec";

/**
 * 最後のスライドの画像: 最後のスライドの真ん中に並べる、管理者が投稿の型の設定でアップロードした画像1枚（REQ-007）。
 * 持つのは Storage の保存先だけ（並びの順は最後のスライドの画像一覧の中の位置）。
 * 作る前の判断（形式・変換の計画）もここに置く。サーバーは画素数を確かめない（画面で確かめる。BR-007-02）。Java の ClosingImage と揃える
 */
export class ClosingImage {
  /** 枠の大きさ（テンプレートの 400×500px）。切り抜いたあとがこれより小さい画像は受け付けない */
  static readonly MIN_WIDTH = 400;
  static readonly MIN_HEIGHT = 500;
  /** 保存の大きさの上限（枠の2倍。ぼやけない）。これより大きければ縮小する（拡大はしない） */
  static readonly MAX_WIDTH = 800;
  /** 縦横比 4:5 */
  static readonly ASPECT = 0.8;
  static readonly TOO_SMALL = "縦500px・横400px 以上の画像を選んでください";
  static readonly WRONG_TYPE = "PNG か JPEG を選んでください";
  private static readonly TYPES: readonly string[] = ["image/png", "image/jpeg"];

  private constructor(readonly storagePath: string) {}

  /** 保存先から作る（記録から戻す・アップロード先を決めたとき）。保存先の形（自分の団体の設定の場所）は RPC が検査する */
  static restore(storagePath: string): ClosingImage {
    if (storagePath.trim() === "") throw new Error("最後のスライドの画像の保存先は必須です");
    return new ClosingImage(storagePath);
  }

  /** アップロードできる形式（PNG・JPEG）か */
  static acceptsType(mimeType: string): boolean {
    return ClosingImage.TYPES.includes(mimeType);
  }

  /**
   * アップロードの変換の計画: 中央を 4:5 に切り抜き（横長なら左右、縦長なら上下を同じ幅ずつ。丸めは Math.round）、
   * 幅 800 より大きければ 800×1000 に縮小する（拡大しない）。切り抜いたあとが 400×500 より小さければ違反を返す
   */
  static planUpload(source: { width: number; height: number }) {
    const crop = ImageSpec.cropAreaOf(source, { aspect: ClosingImage.ASPECT, focus: 0.5 });
    const width = Math.min(crop.width, ClosingImage.MAX_WIDTH);
    const output = { width, height: Math.round(width / ClosingImage.ASPECT) };
    const tooSmall = crop.width < ClosingImage.MIN_WIDTH || crop.height < ClosingImage.MIN_HEIGHT;
    return { crop, output, violation: tooSmall ? ClosingImage.TOO_SMALL : null };
  }
}
