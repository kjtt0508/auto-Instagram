import type { DraftProposal } from "@/domain/draft/DraftProposal";
import { Caption } from "@/domain/post/Caption";
import { PostRevision } from "@/domain/post/PostRevision";
import type { PostStyleSettings } from "@/domain/post/PostStyleSettings";
import { PrCategory } from "@/domain/post/PrCategory";
import { Slide } from "@/domain/slide/Slide";
import type { MaterialImage } from "@/domain/slide/MaterialImage";
import { SlideList } from "@/domain/slide/SlideList";
import type { TemplateDraftContent } from "@/lib/api/postCommands";
import { CURRENT_TEMPLATE_VERSION } from "./templateRelease";

// S-07（AIで下書きを作る）の作業中の内容と、それに対する手順（下書き案の取り込み・素材画像の載せ替え・保存の形の組み立て）。
// 画面は入力と表示をつなぐだけにして、手順はここに集める（画面寄りのアプリケーションの値。業務の判断は SlideList・PostRevision に尋ねる）

/** S-07 で作成中の内容 */
export type TemplateWork = {
  ideaText: string; ideaId: string | null; generationId: string | null;
  slides: SlideList | null;
  captionText: string; hashtagText: string; prCategory: PrCategory; sourceUrls: string[];
};

export const EMPTY_TEMPLATE_WORK: TemplateWork = {
  ideaText: "", ideaId: null, generationId: null, slides: null, captionText: "", hashtagText: "", prCategory: PrCategory.NONE, sourceUrls: [],
};

/** 追加のハッシュタグ（空白区切りの入力を語に分けたもの） */
export const additionalHashtagsOf = (work: TemplateWork): string[] => work.hashtagText.split(/\s+/u).filter((t) => t !== "");

/** どの生成から来た下書き案か。parentGenerationId があれば修正指示（手動コピペの修正を含む）の結果 */
export type DraftSource = { ideaId: string; generationId: string; parentGenerationId?: string };

/** 修正の結果か（文言だけ取り込み、素材画像・背景写真・PR区分を保つ）。最初の生成・手動コピペの新規はスライドごと置き換える */
export const isRevision = (work: TemplateWork, source: DraftSource): boolean => source.parentGenerationId !== undefined && work.slides !== null;

/**
 * 下書き案を取り込んだ作業中の内容。最初の生成（と手動コピペの新規）はスライドごと置き換え、
 * 修正は文言だけを取り込む（素材画像・背景写真・PR区分は保つ。REQ-002 BR-002-04）
 */
export function withDraft(work: TemplateWork, draft: DraftProposal, source: DraftSource,
  photos: readonly { id: string; storagePath: string }[]): TemplateWork {
  const common = { ideaId: source.ideaId, generationId: source.generationId, captionText: draft.caption.text, hashtagText: draft.additionalHashtags.join(" ") };
  if (isRevision(work, source) && work.slides) return { ...work, ...common, slides: work.slides.withDraftText(draft) };
  const photo = photos.find((p) => p.id === draft.backgroundPhotoId);
  return { ...work, ...common, slides: SlideList.createFromDraft(draft, photo && { photoId: photo.id, storagePath: photo.storagePath }),
    prCategory: draft.prCategory, sourceUrls: [...draft.sourceUrls] };
}

/** 指定した位置の中のスライドの素材画像を載せ替えた作業中の内容（中のスライドでなければそのまま） */
export function withMaterial(work: TemplateWork, index: number, material: MaterialImage): TemplateWork {
  const body = work.slides?.items()[index]?.bodyContent();
  if (!work.slides || !body) return work;
  return { ...work, slides: work.slides.withSlideReplaced(index, Slide.createBody(body.withMaterial(material))) };
}

/** 作業中の内容から作る投稿の版（投稿の型の設定が決まっていて、スライドがあるときだけ） */
export function revisionOf(work: TemplateWork, settings: PostStyleSettings | null): PostRevision | null {
  if (!settings || !work.slides) return null;
  return PostRevision.ofSlides({ caption: Caption.restore(work.captionText), prCategory: work.prCategory, slides: work.slides,
    templateVersion: CURRENT_TEMPLATE_VERSION, settings, additionalHashtags: additionalHashtagsOf(work) });
}

/** 保存（save_post_revision）に渡す内容 */
export function toDraftContent(work: TemplateWork & { slides: SlideList }): TemplateDraftContent {
  return { slides: work.slides, captionText: work.captionText, prCategory: work.prCategory,
    additionalHashtags: additionalHashtagsOf(work), generationId: work.generationId };
}
