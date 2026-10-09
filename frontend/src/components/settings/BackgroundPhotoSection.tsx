"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/session/SessionGate";
import { Button } from "@/components/ui/Button";
import { Cell, GroupedSection } from "@/components/ui/Grouped";
import { BackgroundPhoto, BackgroundPhotoList } from "@/domain/slide/BackgroundPhotoList";
import { registerBackgroundPhoto, retireBackgroundPhoto } from "@/lib/api/generationAdministration";
import { uploadBackgroundPhoto, viewUrls } from "@/lib/api/mediaStorage";
import { usableBackgroundPhotos } from "@/lib/api/styleRepository";
import { convertForInstagram } from "@/lib/image/imageConversion";
import { FORM_INPUT, FormField } from "./AdminPage";

/** 表紙の背景の縦横比（4:5。スライドの表紙と同じ） */
const COVER_ASPECT = 0.8;

/** 変換済みで、まだ登録していない写真 */
type Pending = { blob: Blob; previewUrl: string };

/** S-14 背景写真: 写真の一覧（説明文つき）→「写真を足す」→ 各写真の「使わない」（使う写真が30枚なら「足す」を出さない。BR-002-21） */
export function BackgroundPhotoSection() {
  const { tenant } = useSession();
  const [list, setList] = useState<BackgroundPhotoList | null>(null);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [description, setDescription] = useState("");
  const [retiring, setRetiring] = useState<string | null>(null);

  const load = () => usableBackgroundPhotos().then((photos) => {
    setList(BackgroundPhotoList.of(photos.map((p) => BackgroundPhoto.restore(p))));
    return viewUrls(photos.map((p) => p.storagePath)).catch(() => new Map<string, string>()).then(setUrls);
  });
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.previewUrl); }, [pending]);

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

  const choose = (file: File | undefined) => file && withBusy("画像を変換しています…", async () => {
    const converted = await convertForInstagram(file, { aspect: COVER_ASPECT, focus: 0.5 });
    setPending({ blob: converted.blob, previewUrl: URL.createObjectURL(converted.blob) });
    setDescription("");
  });

  const register = () => pending && withBusy("登録しています…", async () => {
    await registerBackgroundPhoto(await uploadBackgroundPhoto(tenant, pending.blob), description);
    setPending(null);
    await load();
  });

  const retire = (photo: BackgroundPhoto) => withBusy("「使わない」にしています…", async () => {
    await retireBackgroundPhoto(photo.id);
    setRetiring(null);
    await load();
  });

  const descriptionIssues = description === "" ? [] : BackgroundPhoto.violationsOfDescription(description);
  const canRegister = busy === null && BackgroundPhoto.violationsOfDescription(description).length === 0;
  const footer = error ? <span role="alert" className="text-destructive">{error}</span>
    : list && !list.canAdd() ? `使う写真が${BackgroundPhotoList.MAX}枚です。足すには、使わない写真を増やしてください`
      : "「使わない」にした写真は、これから作る下書きの候補から外れます（消えません。作成済みの投稿はそのまま使えます）";

  return (
    <>
      <GroupedSection title={list ? `使っている写真（${list.count()} / ${BackgroundPhotoList.MAX}枚）` : "使っている写真"} label="背景写真の一覧" footer={footer}>
        {list === null && !error && <Cell><span className="text-secondary-label">読み込み中…</span></Cell>}
        {list?.count() === 0 && <Cell><span className="text-secondary-label">まだ写真がありません。登録するまで、表紙の背景は紺の単色になります</span></Cell>}
        {list?.photos().map((photo) => (
          <PhotoRow key={photo.id} photo={photo} url={urls.get(photo.storagePath)} confirming={retiring === photo.id} busy={busy !== null}
            onAsk={() => setRetiring(photo.id)} onCancel={() => setRetiring(null)} onRetire={() => retire(photo)} />
        ))}
      </GroupedSection>

      {busy && <p role="status" className="px-4 pt-3 text-center text-secondary-label">{busy}</p>}

      {pending && (
        <GroupedSection title="新しい写真" label="新しい写真">
          <Cell>
            {/* eslint-disable-next-line @next/next/no-img-element -- 変換した写真のプレビュー（blob URL） */}
            <img src={pending.previewUrl} alt="変換した写真のプレビュー" className="mx-auto aspect-[4/5] max-h-64 rounded-[8px] object-cover" />
          </Cell>
          <FormField label="説明文（AI が話題に合う写真を選ぶ手がかり）" count={`${[...description].length} / ${BackgroundPhoto.DESCRIPTION_MAX}`} violations={descriptionIssues}>
            <input aria-label="説明文" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例: 今出川キャンパスの正門" className={FORM_INPUT} />
          </FormField>
          <div className="flex gap-2 p-2">
            <Button variant="tinted" block disabled={busy !== null} onClick={() => setPending(null)}>やめる</Button>
            <Button variant="filled" block disabled={!canRegister} onClick={register}>登録</Button>
          </div>
        </GroupedSection>
      )}

      {list?.canAdd() && !pending && !busy && (
        <GroupedSection label="写真の追加">
          <label className="flex min-h-11 cursor-pointer items-center justify-center px-4 py-2.5 text-[17px] text-tint active:bg-fill">
            写真を足す
            <input type="file" accept="image/jpeg,image/png" aria-label="写真を足す" className="sr-only"
              onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </GroupedSection>
      )}
    </>
  );
}

function PhotoRow({ photo, url, confirming, busy, onAsk, onCancel, onRetire }: {
  photo: BackgroundPhoto; url: string | undefined; confirming: boolean; busy: boolean;
  onAsk: () => void; onCancel: () => void; onRetire: () => void;
}) {
  return (
    <Cell>
      <div data-photo-id={photo.id} className="flex items-center gap-3">
        {url
          // eslint-disable-next-line @next/next/no-img-element -- 期限付き URL の画像（最適化しない）
          ? <img src={url} alt="" className="aspect-[4/5] w-14 shrink-0 rounded-[6px] object-cover" />
          : <div className="aspect-[4/5] w-14 shrink-0 rounded-[6px] bg-fill" />}
        <span className="min-w-0 flex-1 break-words text-[15px]">{photo.description}</span>
        {!confirming && <Button variant="destructive" disabled={busy} onClick={onAsk} aria-label={`${photo.description}を使わない`} className="shrink-0 !px-2">使わない</Button>}
      </div>
      {confirming && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <span className="mr-auto text-[13px] text-secondary-label">候補から外します（消えません）</span>
          <Button variant="tinted" disabled={busy} onClick={onCancel}>やめる</Button>
          <Button variant="destructive-filled" disabled={busy} onClick={onRetire}>使わなくする</Button>
        </div>
      )}
    </Cell>
  );
}
