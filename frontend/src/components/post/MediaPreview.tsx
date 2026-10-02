"use client";

import { useEffect, useState } from "react";
import type { PostMediaList } from "@/domain/post/PostMediaList";
import { viewUrls } from "@/lib/api/mediaStorage";

/** 投稿画像を横にスワイプして見せる（非公開バケットの期限付き URL） */
export function MediaPreview({ media }: { media: PostMediaList }) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    viewUrls(media.items().map((m) => m.storagePath)).then(setUrls, () => setUrls(new Map()));
  }, [media]);

  if (media.count() === 0) return null;
  return (
    <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pt-2">
      {media.items().map((m) => (
        <li key={m.storagePath} className={`${media.count() > 1 ? "w-[85%]" : "w-full"} shrink-0 snap-center`}>
          {urls.get(m.storagePath)
            // eslint-disable-next-line @next/next/no-img-element -- 静的出力では next/image の最適化を使わない
            ? <img src={urls.get(m.storagePath)} alt={`${m.position}枚目`} className="w-full rounded-cell" />
            : <div className="rounded-cell bg-fill" style={{ aspectRatio: m.aspectRatio() }} />}
        </li>
      ))}
    </ul>
  );
}
