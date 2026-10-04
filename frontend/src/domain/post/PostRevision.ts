import type { DraftProposal } from "../draft/DraftProposal";
import type { SlideList } from "../slide/SlideList";
import { AiDisclosure } from "./AiDisclosure";
import { Caption } from "./Caption";
import type { PostMediaList } from "./PostMediaList";
import type { PostStyleSettings } from "./PostStyleSettings";
import type { PrCategory } from "./PrCategory";
import { PublishCaption } from "./PublishCaption";

/**
 * 投稿の版: 投稿の内容の1つの版。中身は「投稿画像一覧（写真をアップロードした投稿）」か
 * 「スライド構成＋投稿の型の設定の版＋追加のハッシュタグ（テンプレートの投稿）」のどちらか一方と、キャプション・PR区分。
 * 版は変更しない（変えるときは新しい版を作る）。記録から戻すときは中身を検査しない（violationsForApproval で承認依頼の前に出す）。
 * 最後のスライドの過去の投稿は持たない（承認の出来事で決まり、画像化のときに SlideList.withPastPosts で渡す）。
 * Java の PostRevision と揃える
 */
export class PostRevision {
  private constructor(
    readonly caption: Caption,
    readonly prCategory: PrCategory,
    private readonly photos: PostMediaList | undefined,
    private readonly template: { slides: SlideList; settings: PostStyleSettings; additionalHashtags: readonly string[] } | undefined,
  ) {}

  /** 写真をアップロードした投稿の版 */
  static ofPhotos(parts: { caption: Caption; prCategory: PrCategory; media: PostMediaList }): PostRevision {
    return new PostRevision(parts.caption, parts.prCategory, parts.media, undefined);
  }

  /** テンプレートの投稿の版 */
  static ofSlides(parts: {
    caption: Caption; prCategory: PrCategory; slides: SlideList; settings: PostStyleSettings; additionalHashtags: readonly string[];
  }): PostRevision {
    return new PostRevision(parts.caption, parts.prCategory, undefined,
      { slides: parts.slides, settings: parts.settings, additionalHashtags: [...parts.additionalHashtags] });
  }

  /** 投稿画像一覧（テンプレートの投稿では空） */
  media(): PostMediaList | undefined {
    return this.photos;
  }

  /** スライド構成（写真をアップロードした投稿では undefined） */
  slides(): SlideList | undefined {
    return this.template?.slides;
  }

  /** 写真風の生成画像を含むか（投稿画像一覧かスライド構成に委ねる） */
  requiresAiDisclosure(): boolean {
    return (this.photos ?? this.template?.slides)?.requiresAiDisclosure() ?? false;
  }

  /** 承認時の確認（「写真風の生成画像を含みます」）が要るか */
  needsApprovalCheck(): boolean {
    return (this.photos ?? this.template?.slides)?.needsApprovalCheck() ?? false;
  }

  aiDisclosure(): AiDisclosure {
    return AiDisclosure.of(this);
  }

  /** 公開用キャプション（投稿の型の設定の版・AI生成の表示とあわせて組み立てる）。上限を超えるなら例外 */
  publishCaption(prLabel: string): PublishCaption {
    return PublishCaption.of(this.parts(prLabel));
  }

  /** 承認を依頼できない理由のうち、キャプション・スライド構成・ハッシュタグに関するもの（投稿画像の仕様は Post が見る） */
  violationsForApproval(prLabel: string): string[] {
    const bodyViolations = Caption.violationsOf(this.caption.text);
    const template = this.template;
    if (!template) return bodyViolations.length > 0 ? bodyViolations : PublishCaption.restore(this.parts(prLabel)).violations();
    const hashtagViolations = template.settings.fixedHashtags().violationsOfAdditional(template.additionalHashtags);
    const earlier = [...template.slides.violations(), ...bodyViolations, ...hashtagViolations];
    return earlier.length > 0 ? earlier : PublishCaption.restore(this.parts(prLabel)).violations();
  }

  /** 下書き案の文言を取り込んだ新しい版（素材画像・背景写真は保つ。修正指示の再生成）。テンプレートの投稿だけ */
  withDraftText(draft: DraftProposal): PostRevision {
    if (!this.template) throw new Error("下書き案を取り込めるのはテンプレートの投稿だけです");
    return PostRevision.ofSlides({ caption: draft.caption, prCategory: draft.prCategory, slides: this.template.slides.withDraftText(draft),
      settings: this.template.settings, additionalHashtags: draft.additionalHashtags });
  }

  /** 画像化に必要な画像の参照（背景写真・素材画像・ロゴの保存先）。過去の投稿の表紙は承認で決まるので含まない */
  imageRefs(): readonly string[] {
    if (!this.template) return [];
    const logo = this.template.settings.logoStoragePath;
    return [...this.template.slides.imageRefs(), ...(logo ? [logo] : [])];
  }

  private parts(prLabel: string): Parameters<typeof PublishCaption.restore>[0] {
    const template = this.template;
    return {
      prefix: this.prCategory.labelPrefix(prLabel), caption: this.caption, disclosure: this.aiDisclosure(),
      footer: template?.settings.captionFooter(),
      hashtags: template?.settings.fixedHashtags().mergedWith(template.additionalHashtags),
    };
  }
}
