"use client";

import { useState } from "react";
import { GroupedSection } from "@/components/ui/Grouped";
import type { GeneratedImage } from "@/domain/post/GeneratedImage";
import { PostMedia } from "@/domain/post/PostMedia";
import type { PostMediaList } from "@/domain/post/PostMediaList";
import type { Tenant } from "@/domain/tenant/Tenant";
import { uploadDraftImage } from "@/lib/api/mediaStorage";
import { convertForInstagram } from "@/lib/image/imageConversion";
import { ImageGenerationSheet, type ChosenCandidate } from "./ImageGenerationSheet";
import { MediaPreview } from "./MediaPreview";

const FOCUS_CHOICES = [{ label: "上", focus: 0 }, { label: "中央", focus: 0.5 }, { label: "下", focus: 1 }];

/**
 * 画像を撮る・選ぶ（スマホからの投稿が主。AC-001-04〜06）。選んだ画像は画像仕様に合わせて変換して保存する。
 * 投稿種別は枚数で決まる（1枚=画像、2枚以上=カルーセル）。2枚目以降は1枚目の縦横比にそろえる。
 * トリミング位置は選び直せる（元の画像を覚えている間だけ）。
 */
export function MediaPicker({ tenant, media, onChange }: {
  tenant: Tenant; media: PostMediaList; onChange: (media: PostMediaList) => void;
}) {
  const [sources] = useState(() => new Map<string, Blob>());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  /** 変換して保存する。生成画像なら由来（GeneratedImage）を付ける（選び直しても引き継ぐ。REQ-005 設計 3章） */
  const convertAndUpload = async (file: Blob, target: { aspect: number | undefined; focus: number; generated?: GeneratedImage | null }) => {
    const converted = await convertForInstagram(file, { aspect: target.aspect, focus: target.focus });
    const storagePath = await uploadDraftImage(tenant, converted.blob);
    sources.set(storagePath, file);
    return PostMedia.of({ position: 1, storagePath, width: converted.width, height: converted.height,
      bytes: converted.blob.size, generated: target.generated ?? null });
  };

  const withBusy = async (message: string, work: () => Promise<void>) => {
    setBusy(message);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const add = (files: File[]) => withBusy("画像を変換しています…", async () => {
    let list = media;
    for (const file of files.slice(0, list.remainingSlots())) {
      list = list.appended(await convertAndUpload(file, { aspect: list.firstAspect() ?? undefined, focus: 0.5 }));
      onChange(list);
    }
  });

  /** AI で作った候補を採用する（4:5、カルーセルの2枚目以降は1枚目に合わせる。BR-005-03） */
  const adopt = async (chosen: ChosenCandidate[]) => {
    let list = media;
    for (const { candidate, image } of chosen.slice(0, list.remainingSlots())) {
      list = list.appended(await convertAndUpload(image, { aspect: candidate.targetAspect(list), focus: 0.5, generated: candidate.adopted() }));
    }
    onChange(list);
  };

  const recrop = (position: number, focus: number) => withBusy("トリミングしています…", async () => {
    const target = media.items()[position - 1];
    const file = sources.get(target.storagePath);
    if (!file) return;
    const aspect = position === 1 && !target.generated ? undefined : media.firstAspect() ?? undefined;
    const recropped = await convertAndUpload(file, { aspect, focus, generated: target.generated });
    onChange(media.without(position).inserted(recropped.movedTo(position)));
  });

  const footer = error ? <span role="alert" className="text-destructive">{error}</span>
    : media.count() === 0 ? "Instagram の仕様（縦横比4:5〜1.91:1・幅1440px以下の JPEG）に自動で変換します"
      : `${media.format().label}の投稿（${media.count()}枚）。2枚以上でカルーセルになります（最大10枚）`;

  return (
    <>
      <MediaPreview media={media} />
      <GroupedSection title="画像" label="画像" footer={footer}>
        {media.items().map((m) => (
          <MediaRow key={m.storagePath} position={m.position} canRecrop={sources.has(m.storagePath)} busy={busy !== null}
            onForward={() => onChange(media.movedForward(m.position))} onRemove={() => onChange(media.without(m.position))}
            onRecrop={(focus) => recrop(m.position, focus)} />
        ))}
        {busy && <p className="px-4 py-3 text-center text-secondary-label">{busy}</p>}
        {!busy && media.remainingSlots() > 0 && (
          <div className="grid grid-cols-3">
            <PickButton label="写真を撮る" icon={CAMERA} capture onFiles={add} />
            <PickButton label="写真を選ぶ" icon={PHOTOS} multiple onFiles={add} />
            <button type="button" onClick={() => setGenerating(true)}
              className="flex min-h-20 flex-col items-center justify-center gap-1 border-l border-separator text-[15px] text-tint active:bg-fill">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 fill-none stroke-current" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
                <path d={SPARKLES} />
              </svg>
              AIで作る
            </button>
          </div>
        )}
      </GroupedSection>
      {generating && <ImageGenerationSheet maxChoices={media.remainingSlots()} onChoose={adopt} onClose={() => setGenerating(false)} />}
    </>
  );
}

const SPARKLES = "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z";

function MediaRow({ position, canRecrop, busy, onForward, onRemove, onRecrop }: {
  position: number; canRecrop: boolean; busy: boolean; onForward: () => void; onRemove: () => void; onRecrop: (focus: number) => void;
}) {
  return (
    <div className="border-b border-separator px-4 py-2">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <span>{position}枚目</span>
        <span className="flex gap-1">
          {position > 1 && <SmallButton onClick={onForward}>前へ</SmallButton>}
          <SmallButton destructive onClick={onRemove}>削除</SmallButton>
        </span>
      </div>
      {canRecrop && (
        <div className="flex items-center gap-1 pt-1 text-[13px] text-secondary-label">
          <span className="mr-1">切り取る位置</span>
          {FOCUS_CHOICES.map((c) => <SmallButton key={c.label} disabled={busy} onClick={() => onRecrop(c.focus)}>{c.label}</SmallButton>)}
        </div>
      )}
    </div>
  );
}

const CAMERA = "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z";
const PHOTOS = "M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M15.5 9.5h.01";

/** 写真を撮る（capture でカメラを直接開く）・写真を選ぶ（写真ライブラリ） */
function PickButton({ label, icon, capture, multiple, onFiles }: {
  label: string; icon: string; capture?: boolean; multiple?: boolean; onFiles: (files: File[]) => void;
}) {
  return (
    <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 text-[15px] text-tint active:bg-fill [&+&]:border-l [&+&]:border-separator">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 fill-none stroke-current" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round">
        <path d={icon} />
      </svg>
      {label}
      <input type="file" accept="image/jpeg,image/png,image/heic,image/heif" aria-label={label} className="sr-only"
        capture={capture ? "environment" : undefined} multiple={multiple}
        onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </label>
  );
}

function SmallButton({ destructive, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button type="button" {...props}
      className={`min-h-9 rounded-full bg-fill px-3 text-[15px] active:opacity-60 disabled:opacity-40 ${destructive ? "text-destructive" : "text-tint"}`} />
  );
}
