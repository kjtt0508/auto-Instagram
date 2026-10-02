import { PostStatus } from "./PostStatus";

/** 投稿履歴: 投稿に起きた出来事の記録（追記のみ）。画面では誰が・いつ・何をしたかを並べる */
export class PostEvent {
  private static readonly KIND_LABELS: Record<string, string> = {
    CREATED: "作成", APPROVAL_REQUESTED: "承認依頼", APPROVED: "承認・予約", REVISION_REQUESTED: "承認待ちから下書きに戻す",
    SCHEDULE_CANCELLED: "予約取消", PUBLISH_STARTED: "公開開始", PUBLISH_DEFERRED: "公開延期", PUBLISHED: "公開",
    FAILED: "失敗", RETRIED: "再実行", RETURNED_TO_DRAFT: "失敗から下書きに戻す", DISCARDED: "破棄",
  };

  private constructor(
    readonly kindLabel: string,
    readonly to: PostStatus,
    readonly occurredAt: Date,
    readonly detail: { actorName: string | null; note: string | null },
  ) {}

  static restore(parts: {
    kindCode: string; toStatusCode: string; occurredAt: Date; actorName: string | null; note: string | null;
  }): PostEvent {
    const label = PostEvent.KIND_LABELS[parts.kindCode];
    if (!label) throw new Error(`知らない出来事です: ${parts.kindCode}`);
    return new PostEvent(label, PostStatus.from(parts.toStatusCode), parts.occurredAt,
      { actorName: parts.actorName, note: parts.note });
  }

  /** 誰が行ったか（定期処理の出来事は「定期処理」） */
  actorText(): string {
    return this.detail.actorName ?? "定期処理";
  }
}
