"use client";

import { useState } from "react";
import { GroupedSection } from "@/components/ui/Grouped";
import type { PostFormat } from "@/domain/post/PostFormat";
import { PostMedia } from "@/domain/post/PostMedia";
import { PostMediaList } from "@/domain/post/PostMediaList";
import type { Tenant } from "@/domain/tenant/Tenant";
import { uploadDraftImage } from "@/lib/api/mediaStorage";
import { convertForInstagram } from "@/lib/image/imageConversion";
import { MediaPreview } from "./MediaPreview";

const FOCUS_CHOICES = [{ label: "上・左", focus: 0 }, { label: "中央", focus: 0.5 }, { label: "下・右", focus: 1 }];

/**
 * 画像を選び、画像仕様に合わせて変換して保存する（AC-001-04〜06）。
 * 2枚目以降は1枚目の縦横比にそろえる。トリミング位置は選び直せる（元の画像を覚えている間だけ）。
 */
export function MediaPicker({ tenant, format, media, onChange }: {
  tenant: Tenant; format: PostFormat; media: PostMediaList; onChange: (media: PostMediaList) => void;
}) {
  const [sources] = useState(() => new Map<string, Blob>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const convertAndUpload = async (file: Blob, aspect: number | undefined, focus: number) => {
    const converted = await convertForInstagram(file, { aspect, focus });
    const storagePath = await uploadDraftImage(tenant, converted.blob);
    sources.set(storagePath, file);
    return PostMedia.of({ position: 1, storagePath, width: converted.width, height: converted.height, bytes: converted.blob.size });
  };

  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (files: File[]) => withBusy(async () => {
    // 画像1枚の投稿で選び直したら置き換える
    let list = format.alignsAspectToFirst() ? media : PostMediaList.empty();
    for (const file of files.slice(0, format.remainingSlots(list.count()))) {
      const aspect = format.alignsAspectToFirst() ? list.firstAspect() ?? undefined : undefined;
      list = list.appended(await convertAndUpload(file, aspect, 0.5));
      onChange(list);
    }
  });

  const recrop = (position: number, focus: number) => withBusy(async () => {
    const file = sources.get(media.items()[position - 1].storagePath);
    if (!file) return;
    const aspect = position === 1 ? undefined : media.firstAspect() ?? undefined;
    onChange(media.without(position).inserted((await convertAndUpload(file, aspect, focus)).movedTo(position)));
  });

  return (
    <>
      <MediaPreview media={media} />
      <GroupedSection title={`画像（${format.mediaCountRule()}）`} label="画像"
        footer={error ? <span role="alert" className="text-destructive">{error}</span> : "Instagram の仕様（JPEG・幅1440px以下・縦横比4:5〜1.91:1）に自動で変換します"}>
        {media.items().map((m) => (
          <div key={m.storagePath} className="border-b border-separator px-4 py-2">
            <div className="flex min-h-9 items-center justify-between gap-2">
              <span>{m.position}枚目</span>
              <span className="flex gap-1">
                {m.position > 1 && <SmallButton onClick={() => onChange(media.movedForward(m.position))}>前へ</SmallButton>}
                <SmallButton destructive onClick={() => onChange(media.without(m.position))}>削除</SmallButton>
              </span>
            </div>
            {sources.has(m.storagePath) && (
              <div className="flex items-center gap-1 pt-1 text-[13px] text-secondary-label">
                <span className="mr-1">トリミング</span>
                {FOCUS_CHOICES.map((c) => <SmallButton key={c.label} disabled={busy} onClick={() => recrop(m.position, c.focus)}>{c.label}</SmallButton>)}
              </div>
            )}
          </div>
        ))}
        <label className={`block min-h-11 px-4 py-2.5 text-center text-tint active:bg-fill ${busy ? "opacity-40" : "cursor-pointer"}`}>
          {busy ? "画像を変換しています…" : "画像を選ぶ"}
          <input type="file" accept="image/jpeg,image/png,image/heic" multiple={format.alignsAspectToFirst()} disabled={busy}
            className="sr-only" aria-label="画像を選ぶ" onChange={(e) => add([...(e.target.files ?? [])])} />
        </label>
      </GroupedSection>
    </>
  );
}

function SmallButton({ destructive, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button type="button" {...props}
      className={`min-h-8 rounded-full bg-fill px-3 text-[13px] active:opacity-60 disabled:opacity-40 ${destructive ? "text-destructive" : "text-tint"}`} />
  );
}
