import type { DraftProposal } from "../draft/DraftProposal";
import type { SlideList } from "../slide/SlideList";
import { AiDisclosure } from "./AiDisclosure";
import { Caption } from "./Caption";
import type { PostMediaList } from "./PostMediaList";
import type { PostStyleSettings } from "./PostStyleSettings";
import type { PrCategory } from "./PrCategory";
import { PublishCaption } from "./PublishCaption";
import { RevisionContent } from "./RevisionContent";

/**
 * 投稿の版: 投稿の内容の1つの版。投稿の版の中身（写真の投稿は投稿画像一覧、テンプレートの投稿はスライド構成・テンプレートの版・
 * 投稿の型の設定の版・追加のハッシュタグ）と、キャプション・PR区分。形ごとの違いは中身に委ね、ここでは分岐しない。
 * 版は変更しない（変えるときは新しい版を作る）。記録から戻すときは中身を検査しない（violationsForApproval で承認依頼の前に出す）。
 * 最後のスライドの過去の投稿は持たない（承認の出来事で決まり、画像化のときに SlideList.withPastPosts で渡す）。
 * Java の PostRevision と揃える
 */
export class PostRevision {
  private constructor(
    readonly caption: Caption,
    readonly prCategory: PrCategory,
    private readonly content: RevisionContent,
  ) {}

  /** 写真をアップロードした投稿の版 */
  static ofPhotos(parts: { caption: Caption; prCategory: PrCategory; media: PostMediaList }): PostRevision {
    return new PostRevision(parts.caption, parts.prCategory, RevisionContent.photos(parts.media));
  }

  /** テンプレートの投稿の版（templateVersion は例 niijima@1） */
  static ofSlides(parts: {
    caption: Caption; prCategory: PrCategory; slides: SlideList; templateVersion: string; settings: PostStyleSettings;
    additionalHashtags: readonly string[];
  }): PostRevision {
    return new PostRevision(parts.caption, parts.prCategory, RevisionContent.template(parts));
  }

  /** 公開用画像が何枚になるか（中身に委ねる） */
  expectedPublishMediaCount(): number {
    return this.content.expectedPublishMediaCount();
  }

  /** 公開用画像の準備のしかた（複製か画像化か。中身に委ねる） */
  preparation(): "COPY" | "RENDER" {
    return this.content.preparation();
  }

  /** 写真風の生成画像を含むか（中身に委ねる） */
  requiresAiDisclosure(): boolean {
    return this.content.requiresAiDisclosure();
  }

  /** 承認時の確認（「写真風の生成画像を含みます」）が要るか（中身に委ねる） */
  needsApprovalCheck(): boolean {
    return this.content.needsApprovalCheck();
  }

  aiDisclosure(): AiDisclosure {
    return AiDisclosure.of(this);
  }

  /** 公開用キャプション（投稿の型の設定の版・AI生成の表示とあわせて組み立てる）。上限を超えるなら例外 */
  publishCaption(prLabel: string): PublishCaption {
    return PublishCaption.of(this.parts(prLabel));
  }

  /**
   * 承認を依頼できない理由のすべて（中身のスライド構成・追加のハッシュタグ、キャプション本文、付記・定型・ハッシュタグ込みの上限）。
   * 本文で既に出した文字数・ハッシュタグ数の違反は、公開用キャプションからは重ねて出さない（投稿画像の仕様は Post が見る）
   */
  violationsForApproval(prLabel: string): string[] {
    const body = Caption.violationsOf(this.caption.text);
    const published = PublishCaption.restore(this.parts(prLabel));
    const lengthOver = this.caption.length() > Caption.MAX_LENGTH;
    const hashtagsOver = this.caption.hashtagCount() > Caption.MAX_HASHTAGS;
    const lengthViolation = published.lengthViolation();
    return [
      ...this.content.violations(),
      ...body,
      ...(!lengthOver && lengthViolation ? [lengthViolation] : []),
      ...(!hashtagsOver ? published.hashtagViolations() : []),
    ];
  }

  /**
   * 下書き案の文言を取り込んだ新しい版（素材画像・背景写真・PR区分は保つ。修正指示の再生成）。
   * 人が設定したPR区分は修正で変わらない（BR-002-04）。追加のハッシュタグは文言の一部として取り込む。テンプレートの投稿だけ
   */
  withDraftText(draft: DraftProposal): PostRevision {
    const content = this.content.withDraftText(draft);
    return new PostRevision(draft.caption, this.prCategory, content);
  }

  /** 画像化に必要な画像の参照（背景写真・素材画像・ロゴの保存先）。過去の投稿の表紙は承認で決まるので含まない */
  imageRefs(): readonly string[] {
    return this.content.imageRefs();
  }

  private parts(prLabel: string): Parameters<typeof PublishCaption.restore>[0] {
    return {
      prefix: this.prCategory.labelPrefix(prLabel), caption: this.caption, disclosure: this.aiDisclosure(),
      footer: this.content.captionFooter(), hashtags: this.content.hashtags(),
    };
  }
}
