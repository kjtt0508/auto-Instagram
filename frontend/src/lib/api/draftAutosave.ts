import { PostMedia } from "@/domain/post/PostMedia";
import { PostMediaList } from "@/domain/post/PostMediaList";
import { PrCategory } from "@/domain/post/PrCategory";
import type { DraftContent } from "./postCommands";

// 作成中の新しい投稿を端末（localStorage）に一時保存する。スマホでカメラを開いて戻ったときや、
// 画面が再読み込みされたときに入力が消えないようにする。保存（RPC）できたら消す。端末の外には出さない
const KEY = "niijimaig:new-post-draft";

type Stored = { captionText: string; prCategory: string; media: ReturnType<PostMedia["toRevisionMedia"]>[] };

export function rememberNewDraft(draft: DraftContent): void {
  const stored: Stored = { captionText: draft.captionText, prCategory: draft.prCategory.code,
    media: draft.media.items().map((m) => m.toRevisionMedia()) };
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
      width: m.width, height: m.height, bytes: m.byteSize })));
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
