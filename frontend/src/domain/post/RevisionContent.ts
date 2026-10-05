import type { DraftProposal } from "../draft/DraftProposal";
import type { SlideList } from "../slide/SlideList";
import type { CaptionFooter } from "./CaptionFooter";
import type { PostMediaList } from "./PostMediaList";
import type { PostStyleSettings } from "./PostStyleSettings";

/**
 * 投稿の版の中身: 投稿の形ごとに異なる中身。写真の投稿＝投稿画像一覧／テンプレートの投稿＝スライド構成・テンプレートの版・
 * 投稿の型の設定の版・追加のハッシュタグ。どちらか一方の形だけを取り、形ごとの違いは呼び出し側が分岐せず中身に尋ねる。
 * Java の RevisionContent と揃える
 */
export interface RevisionContent {
  /** 公開用画像が何枚になるか */
  expectedPublishMediaCount(): number;
  /** 公開用画像の準備のしかた（COPY＝アップロードの投稿は公開用の保存先への複製、RENDER＝テンプレートの投稿は画像化） */
  preparation(): "COPY" | "RENDER";
  /** 写真風の生成画像を含むか */
  requiresAiDisclosure(): boolean;
  /** 承認時の確認（「写真風の生成画像を含みます」）が要るか */
  needsApprovalCheck(): boolean;
  /** 公開用キャプションに足すキャプションの定型（写真の投稿は無し） */
  captionFooter(): CaptionFooter | undefined;
  /** 公開用キャプションに足すハッシュタグ（固定→追加、重複を除く。写真の投稿は無し） */
  hashtags(): readonly string[];
  /** 画像化に必要な画像の参照（背景写真・素材画像・ロゴの保存先。写真の投稿は無し） */
  imageRefs(): readonly string[];
  /** 承認を依頼できない理由のうち、中身に関するもの（スライド構成・追加のハッシュタグ。投稿画像の仕様は Post が見る） */
  violations(): string[];
  /** 下書き案の文言を取り込んだ新しい中身。テンプレートの投稿だけ（写真の投稿は例外） */
  withDraftText(draft: DraftProposal): RevisionContent;
}

const templateContent = (parts: {
  slides: SlideList; templateVersion: string; settings: PostStyleSettings; additionalHashtags: readonly string[];
}): RevisionContent => ({
  expectedPublishMediaCount: () => parts.slides.count(),
  preparation: () => "RENDER",
  requiresAiDisclosure: () => parts.slides.requiresAiDisclosure(),
  needsApprovalCheck: () => parts.slides.needsApprovalCheck(),
  captionFooter: () => parts.settings.captionFooter(),
  hashtags: () => parts.settings.fixedHashtags().mergedWith(parts.additionalHashtags),
  imageRefs: () => {
    const logo = parts.settings.logoStoragePath;
    return [...parts.slides.imageRefs(), ...(logo ? [logo] : [])];
  },
  violations: () => [
    ...parts.slides.violations(),
    ...parts.settings.fixedHashtags().violationsOfAdditional(parts.additionalHashtags),
  ],
  /** 文言（スライドの文言・追加のハッシュタグ）を取り込む。素材画像・背景写真・テンプレートの版・設定の版は保つ */
  withDraftText: (draft) => templateContent({ ...parts, slides: parts.slides.withDraftText(draft), additionalHashtags: [...draft.additionalHashtags] }),
});

export const RevisionContent = {
  /** 写真の投稿の中身 */
  photos(media: PostMediaList): RevisionContent {
    return {
      expectedPublishMediaCount: () => media.count(),
      preparation: () => "COPY",
      requiresAiDisclosure: () => media.requiresAiDisclosure(),
      needsApprovalCheck: () => media.needsApprovalCheck(),
      captionFooter: () => undefined,
      hashtags: () => [],
      imageRefs: () => [],
      violations: () => [],
      withDraftText: () => {
        throw new Error("下書き案を取り込めるのはテンプレートの投稿だけです");
      },
    };
  },

  /** テンプレートの投稿の中身（templateVersion は使うテンプレートの版の名前。例 niijima@1） */
  template(parts: {
    slides: SlideList; templateVersion: string; settings: PostStyleSettings; additionalHashtags: readonly string[];
  }): RevisionContent {
    if (parts.templateVersion.trim() === "") throw new Error("テンプレートの版は必須です");
    return templateContent({ ...parts, additionalHashtags: [...parts.additionalHashtags] });
  },
};
