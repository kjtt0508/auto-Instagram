"use client";

import { useEffect, useRef, useState } from "react";
import { ClosingImage } from "@/domain/post/ClosingImage";
import { ClosingImageList } from "@/domain/post/ClosingImageList";
import type { Tenant } from "@/domain/tenant/Tenant";
import { newClosingImagePath, uploadStyleClosingImage, viewUrls } from "@/lib/api/mediaStorage";
import { convertClosingImage } from "@/lib/image/imageConversion";

type Pending = { blob: Blob; url: string };

/**
 * S-15 の「最後のスライドの画像」の編集中の状態（REQ-007）。画像の並び（足す・選び直す・外す）は ClosingImageList が決め、
 * ここは画面の都合（変換・プレビューの URL・保存のときのアップロード）だけを持つ。
 * 選んだ画像は変換してその場で保存先を決めておき、置くのは保存のときだけ（外した・保存しなかった画像は置かない）
 */
export function useClosingImages(initial: ClosingImageList, tenant: Tenant, onEdited: () => void) {
  const [list, setList] = useState(initial);
  const [pending, setPending] = useState<ReadonlyMap<string, Pending>>(new Map());
  const [savedUrls, setSavedUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const created = useRef<string[]>([]);
  const uploaded = useRef(new Set<string>());

  useEffect(() => {
    const paths = initial.refs();
    if (paths.length === 0) return;
    viewUrls(paths).then(setSavedUrls, () => setSavedUrls(new Map()));
  }, [initial]);
  useEffect(() => () => created.current.forEach((url) => URL.revokeObjectURL(url)), []);

  /** index があればその順の画像を選び直し、無ければ後ろに足す。違反（小さい・形式・読めない）は理由を出して入れない */
  const pick = async (index: number | null, file: File | undefined) => {
    if (!file) return;
    setError(null);
    setConverting(true);
    try {
      const blob = await convertClosingImage(file);
      const path = newClosingImagePath(tenant);
      const url = URL.createObjectURL(blob);
      created.current.push(url);
      const image = ClosingImage.restore(path);
      setList(index === null ? list.add(image) : list.replace(index, image));
      setPending(new Map(pending).set(path, { blob, url }));
      onEdited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConverting(false);
    }
  };

  const remove = (index: number) => {
    setError(null);
    setList(list.remove(index));
    onEdited();
  };

  /** 保存のとき、新しく選んだ画像（まだ置いていないもの）を置き、並べる順の保存先を返す */
  const upload = async (): Promise<readonly string[]> => {
    for (const path of list.refs()) {
      const item = pending.get(path);
      if (!item || uploaded.current.has(path)) continue; // 保存の再試行では、置いた画像をもう一度置かない（同じ名前は置けない）
      await uploadStyleClosingImage(path, item.blob);
      uploaded.current.add(path);
    }
    return list.refs();
  };

  const urlOf = (path: string) => pending.get(path)?.url ?? savedUrls.get(path);
  return { list, error, converting, pick, remove, upload, urlOf };
}
