import { GeneratedImage } from "@/domain/post/GeneratedImage";
import { PostMedia } from "@/domain/post/PostMedia";
import { PostMediaList } from "@/domain/post/PostMediaList";
import { PrCategory } from "@/domain/post/PrCategory";
import type { DraftContent } from "./postCommands";

// 作成中の新しい投稿を端末（localStorage）に一時保存する。スマホでカメラを開いて戻ったときや、
// 画面が再読み込みされたときに入力が消えないようにする。保存（RPC）できたら消す。端末の外には出さない
// 生成画像の由来（画像生成・位置・画像の種類）も残す。消えると写真風なのにAI生成の表示が付かなくなる（REQ-005）
const KEY = "niijimaig:new-post-draft";

type StoredMedia = {
  position: number; storagePath: string; width: number; height: number; byteSize: number;
  generated?: { generationId: string; candidatePosition: number; styleCode: string };
};
type Stored = { captionText: string; prCategory: string; media: StoredMedia[] };

const toStored = (m: PostMedia): StoredMedia => {
  const { position, storagePath, width, height, byteSize } = m.toRevisionMedia();
  const generated = m.generated
    ? { generationId: m.generated.generationId, candidatePosition: m.generated.candidatePosition, styleCode: m.generated.style.code }
    : undefined;
  return { position, storagePath, width, height, byteSize, generated };
};

export function rememberNewDraft(draft: DraftContent): void {
  const stored: Stored = { captionText: draft.captionText, prCategory: draft.prCategory.code, media: draft.media.items().map(toStored) };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // 保存できない端末（プライベートブラウズ等）では一時保存しない
  }
}

/** 一時保存した内容。無ければ・壊れていれば null */
export function recallNewDraft(): Omit<DraftContent, "format" | "genreId"> | null {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Stored | null;
    if (!stored || (stored.captionText === "" && stored.media.length === 0)) return null;
    const media = PostMediaList.of(stored.media.map((m) => PostMedia.of({ position: m.position, storagePath: m.storagePath,
      width: m.width, height: m.height, bytes: m.byteSize, generated: m.generated ? GeneratedImage.of(m.generated) : null })));
    return { captionText: stored.captionText, prCategory: PrCategory.from(stored.prCategory), media };
  } catch {
    return null;
  }
}

export function forgetNewDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 何もしない
  }
}
