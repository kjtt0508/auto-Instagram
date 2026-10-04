import type { Role } from "../member/Role";
import { Caption } from "./Caption";
import type { FailureReason } from "./FailureReason";
import { ImageSpec } from "./ImageSpec";
import type { PostFormat } from "./PostFormat";
import type { PostMediaList } from "./PostMediaList";
import { PostRevision } from "./PostRevision";
import { PostStatus } from "./PostStatus";
import type { PrCategory } from "./PrCategory";
import type { PublishCaption } from "./PublishCaption";
import type { PublishResult } from "./PublishResult";
import type { ScheduledAt } from "./ScheduledAt";

/**
 * 投稿（画面から見た姿）: 最新の版の内容・現在の状態・予約日時・公開結果／失敗理由。
 * 操作の可否（状態×ロール。REQ-001 設計 3章 S-04）と、承認依頼の前の検査を持つ。記録は RPC が行う。
 */
export class Post {
  private static readonly HEADLINE_LENGTH = 40;

  private constructor(
    readonly id: string,
    readonly status: PostStatus,
    readonly content: {
      revisionId: string; format: PostFormat; caption: Caption; prCategory: PrCategory;
      media: PostMediaList; genreId: string | null;
    },
    readonly outcome: { scheduledAt: ScheduledAt | null; result: PublishResult | null; failure: FailureReason | null },
  ) {}

  static restore(parts: {
    id: string; status: PostStatus; content: Post["content"]; outcome: Post["outcome"];
  }): Post {
    if (parts.id === "") throw new Error("投稿IDは必須です");
    return new Post(parts.id, parts.status, parts.content, parts.outcome);
  }

  /** 承認を依頼できない理由（枚数・画像仕様・キャプション・付記込みの文字数。AC-001-07〜09、AC-005-04, 10） */
  static violationsForApprovalRequest(content: {
    readonly format: PostFormat; readonly media: PostMediaList; readonly captionText: string; readonly prCategory: PrCategory;
  }, prLabel: string): string[] {
    const media = content.media.violationsFor(content.format, new ImageSpec());
    const revision = PostRevision.ofPhotos({ caption: Caption.restore(content.captionText), prCategory: content.prCategory, media: content.media });
    return [...media, ...revision.violationsForApproval(prLabel)];
  }

  /** この投稿（最新の版）の内容を表す投稿の版（写真をアップロードした投稿。テンプレートの投稿への対応は REQ-002 の画面の単位で） */
  revision(): PostRevision {
    const { caption, prCategory, media } = this.content;
    return PostRevision.ofPhotos({ caption, prCategory, media });
  }

  /** この投稿（最新の版）で承認を依頼できない理由 */
  violationsBeforeApprovalRequest(prLabel: string): string[] {
    const { format, media, caption, prCategory } = this.content;
    return Post.violationsForApprovalRequest({ format, media, captionText: caption.text, prCategory }, prLabel);
  }

  /** 公開用のキャプション（PR案件ならPR表記、写真風の生成画像を含むならAI生成の表示付き）。プレビューに使う */
  publishCaption(prLabel: string): PublishCaption {
    return this.revision().publishCaption(prLabel);
  }

  /** 承認時に「写真風の生成画像を含みます」の確認を出すか（AC-005-08） */
  needsGeneratedImageCheck(): boolean {
    return this.revision().needsApprovalCheck();
  }

  /** カレンダーに載せる日時（公開済みなら公開日時、それ以外は予約日時。どちらも無ければ null） */
  calendarDate(): Date | null {
    return this.outcome.result?.publishedAt ?? this.outcome.scheduledAt?.toDate() ?? null;
  }

  /** 一覧に出す見出し（キャプションの1行目） */
  headline(): string {
    return this.content.caption.text.split("\n")[0].slice(0, Post.HEADLINE_LENGTH) || "（キャプションなし）";
  }

  canEdit(): boolean {
    return this.status.isEditable();
  }

  canRequestApproval(): boolean {
    return this.status === PostStatus.DRAFT;
  }

  canApprove(role: Role): boolean {
    return this.status === PostStatus.AWAITING_APPROVAL && role.canApprove();
  }

  /** 承認待ちを下書きに戻す（フェーズ3で修正指示に置き換える） */
  canSendBack(role: Role): boolean {
    return this.status === PostStatus.AWAITING_APPROVAL && role.canApprove();
  }

  canCancelSchedule(role: Role): boolean {
    return this.status === PostStatus.SCHEDULED && role.canApprove();
  }

  canRetry(role: Role): boolean {
    return this.status.isFailed() && role.canApprove();
  }

  canReturnToDraft(role: Role): boolean {
    return this.status.isFailed() && role.canApprove();
  }

  /** 下書きの破棄は全ロール、承認待ち・失敗の破棄は承認者以上 */
  canDiscard(role: Role): boolean {
    if (this.status === PostStatus.DRAFT) return true;
    return this.status.canTransitTo(PostStatus.DISCARDED) && role.canApprove();
  }
}
