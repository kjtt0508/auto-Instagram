import { viewUrls } from "@/lib/api/mediaStorage";

// プレビューの iframe は opaque origin で CSP の img-src が data: / blob: だけ（ADR-0010）。画像は data URL にして渡す
const cache = new Map<string, Promise<string>>();

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
    reader.readAsDataURL(blob);
  });
}

/** 保存先のパス → data URL。保存先は一意（変更されない）ので、読み込んだ画像は覚えておく。読めなかったパスは含めない */
export async function previewImages(paths: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths)];
  const missing = wanted.filter((p) => !cache.has(p));
  if (missing.length > 0) {
    const urls = await viewUrls(missing);
    for (const path of missing) {
      const url = urls.get(path);
      if (!url) continue;
      const loading = fetch(url).then((r) => {
        if (!r.ok) throw new Error("画像を読み込めませんでした");
        return r.blob();
      }).then(toDataUrl);
      cache.set(path, loading);
      loading.catch(() => cache.delete(path));
    }
  }
  const loaded = await Promise.all(wanted.map(async (p) => [p, await cache.get(p)?.catch(() => undefined)] as const));
  return new Map(loaded.flatMap(([p, url]) => (url ? [[p, url] as const] : [])));
}
