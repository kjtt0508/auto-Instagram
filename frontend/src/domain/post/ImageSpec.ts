import type { PostMedia } from "./PostMedia";

/**
 * 画像仕様: Instagram API で公開できる画像の条件（JPEG・8MB以下・縦横比4:5〜1.91:1・幅320〜1440px）。
 * JPEG であることは変換で保証し、ここでは寸法と容量を判断する。変換の計画（トリミングと縮小）もここで決める。
 */
export class ImageSpec {
  static readonly MIN_WIDTH = 320;
  static readonly MAX_WIDTH = 1440;
  static readonly MAX_BYTES = 8 * 1024 * 1024;
  static readonly MIN_ASPECT = 0.8;
  static readonly MAX_ASPECT = 1.91;
  /** 8MB を超えたら品質を下げてやり直す（REQ-001 設計 3.1） */
  static readonly JPEG_QUALITIES: readonly number[] = [0.9, 0.8, 0.7];
  private static readonly TOLERANCE = 0.005;

  /** 満たさない項目の説明。空なら仕様どおり */
  violationsOf(media: PostMedia): string[] {
    const violations: string[] = [];
    if (!media.widthWithin(ImageSpec.MIN_WIDTH, ImageSpec.MAX_WIDTH)) {
      violations.push(`画像の幅は${ImageSpec.MIN_WIDTH}〜${ImageSpec.MAX_WIDTH}pxです`);
    }
    if (!media.bytesAtMost(ImageSpec.MAX_BYTES)) violations.push("画像は8MB以下です");
    if (!media.aspectWithin(ImageSpec.MIN_ASPECT - ImageSpec.TOLERANCE, ImageSpec.MAX_ASPECT + ImageSpec.TOLERANCE)) {
      violations.push("画像の縦横比は4:5〜1.91:1です");
    }
    return violations;
  }

  /** 元画像の縦横比を仕様の範囲に丸めたもの（1枚目の目標比率） */
  targetAspectFor(source: { width: number; height: number }): number {
    const aspect = source.width / source.height;
    return Math.min(ImageSpec.MAX_ASPECT, Math.max(ImageSpec.MIN_ASPECT, aspect));
  }

  /**
   * 変換の計画: 目標比率に合わせてトリミングし（focus は切り取る位置。0=左上、0.5=中央、1=右下）、幅1440以下に縮小する。
   * 縮小後の幅が320未満なら変換できない（理由を violation に入れる）。
   */
  planConversion(source: { width: number; height: number }, target: { aspect: number; focus: number }) {
    const crop = this.cropArea(source, target);
    const outputWidth = Math.min(crop.width, ImageSpec.MAX_WIDTH);
    const outputHeight = Math.round(outputWidth / target.aspect);
    const violation = outputWidth < ImageSpec.MIN_WIDTH ? `画像が小さすぎます（幅${ImageSpec.MIN_WIDTH}px以上が必要です）` : null;
    return { crop, output: { width: outputWidth, height: outputHeight }, violation };
  }

  private cropArea(source: { width: number; height: number }, target: { aspect: number; focus: number }) {
    const focus = Math.min(1, Math.max(0, target.focus));
    if (source.width / source.height > target.aspect) {
      const width = Math.round(source.height * target.aspect);
      return { x: Math.round((source.width - width) * focus), y: 0, width, height: source.height };
    }
    const height = Math.round(source.width / target.aspect);
    return { x: 0, y: Math.round((source.height - height) * focus), width: source.width, height };
  }
}
