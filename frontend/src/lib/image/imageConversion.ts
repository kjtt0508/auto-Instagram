import { ImageSpec } from "@/domain/post/ImageSpec";

// ブラウザ内の画像変換（REQ-001 設計 3.1）。比率とトリミング位置の計算は ImageSpec が決め、ここは canvas で描くだけ

export type ConvertedImage = { blob: Blob; width: number; height: number; aspect: number };

/**
 * 画像を画像仕様に合う JPEG にする。aspect を省くと元画像の比率を仕様の範囲に丸めたもの（1枚目）。
 * focus はトリミング位置（0=左上、0.5=中央、1=右下）。
 */
export async function convertForInstagram(file: Blob, target: { aspect?: number; focus: number }): Promise<ConvertedImage> {
  const bitmap = await decode(file);
  const spec = new ImageSpec();
  const source = { width: bitmap.width, height: bitmap.height };
  const aspect = target.aspect ?? spec.targetAspectFor(source);
  const plan = spec.planConversion(source, { aspect, focus: target.focus });
  if (plan.violation) throw new Error(plan.violation);
  const canvas = document.createElement("canvas");
  canvas.width = plan.output.width;
  canvas.height = plan.output.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("この端末では画像を変換できません");
  context.drawImage(bitmap, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height, 0, 0, canvas.width, canvas.height);
  return { blob: await encodeWithinLimit(canvas), width: canvas.width, height: canvas.height, aspect };
}

const LOGO_MAX_SIDE = 1024;

/** ロゴを PNG にする（透明を保つ。長いほうの辺を 1024px 以下に縮小するだけで、切り取らない） */
export async function convertLogo(file: Blob): Promise<Blob> {
  const bitmap = await decode(file);
  const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("この端末では画像を変換できません");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("ロゴを PNG にできませんでした。別の画像を選んでください");
  return blob;
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("この画像は読み込めません。JPEG で選び直してください");
  }
}

/** 8MB を超えたら品質を下げてやり直す */
async function encodeWithinLimit(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of ImageSpec.JPEG_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= ImageSpec.MAX_BYTES) return blob;
  }
  throw new Error("画像を8MB以下にできませんでした。別の画像を選んでください");
}
