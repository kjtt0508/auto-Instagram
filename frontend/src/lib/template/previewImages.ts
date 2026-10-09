import { viewUrls } from "@/lib/api/mediaStorage";

// プレビューの iframe は opaque origin で CSP の img-src が data: / blob: だけ（ADR-0010）。画像は data URL にして渡す
// data URL は大きいので、覚えておく数に上限を付ける（古く使われたものから捨てる）。サインアウトで全部捨てる
const MAX_CACHED = 40;
const cache = new Map<string, Promise<string>>();

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
    reader.readAsDataURL(blob);
  });
}

/** 覚えている画像を、使った順の最後にする（上限を超えたとき、最近使っていないものから捨てるため） */
function touch(path: string, loading: Promise<string>): void {
  cache.delete(path);
  cache.set(path, loading);
}

function evictOldest(): void {
  for (const path of cache.keys()) {
    if (cache.size <= MAX_CACHED) return;
    cache.delete(path);
  }
}

/** 覚えている画像をすべて捨てる（サインアウト。別の人が同じ端末で開いても、前の人の画像は残らない） */
export function forgetPreviewImages(): void {
  cache.clear();
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
      touch(path, loading);
      loading.catch(() => cache.delete(path));
    }
  }
  // 今使う画像は最後に回す（上限を超えても、いま必要なものは捨てない）
  const now = wanted.flatMap((p) => { const c = cache.get(p); return c ? [[p, c] as const] : []; });
  now.forEach(([p, c]) => touch(p, c));
  evictOldest();
  const loaded = await Promise.all(now.map(async ([p, c]) => [p, await c.catch(() => undefined)] as const));
  return new Map(loaded.flatMap(([p, url]) => (url ? [[p, url] as const] : [])));
}
