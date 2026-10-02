/** 投稿状態。投稿履歴から導出する（domain.yaml 投稿状態 / docs/model/fixtures/post-status.json / DB post_status_transitions） */
export class PostStatus {
  static readonly DRAFT = new PostStatus("DRAFT", "下書き", "gray");
  static readonly AWAITING_APPROVAL = new PostStatus("AWAITING_APPROVAL", "承認待ち", "yellow");
  static readonly SCHEDULED = new PostStatus("SCHEDULED", "予約中", "blue");
  static readonly PUBLISHING = new PostStatus("PUBLISHING", "公開処理中", "blue-pulse");
  static readonly PUBLISHED = new PostStatus("PUBLISHED", "公開済み", "green");
  static readonly FAILED = new PostStatus("FAILED", "失敗", "red");
  static readonly DISCARDED = new PostStatus("DISCARDED", "破棄", "gray");

  private static readonly TRANSITIONS: Record<string, readonly string[]> = {
    DRAFT: ["AWAITING_APPROVAL", "DISCARDED"],
    AWAITING_APPROVAL: ["SCHEDULED", "DRAFT", "DISCARDED"],
    SCHEDULED: ["PUBLISHING", "DRAFT", "FAILED"],
    PUBLISHING: ["PUBLISHED", "FAILED", "SCHEDULED"],
    PUBLISHED: [],
    FAILED: ["SCHEDULED", "DRAFT", "DISCARDED"],
    DISCARDED: [],
  };

  private constructor(
    readonly code: string,
    readonly label: string,
    private readonly color: "gray" | "yellow" | "blue" | "blue-pulse" | "green" | "red",
  ) {}

  static all(): readonly PostStatus[] {
    return [
      PostStatus.DRAFT, PostStatus.AWAITING_APPROVAL, PostStatus.SCHEDULED, PostStatus.PUBLISHING,
      PostStatus.PUBLISHED, PostStatus.FAILED, PostStatus.DISCARDED,
    ];
  }

  /** 日付が決まっておらず、人の対応を待っている状態（ホームの「対応待ち」） */
  static awaitingWork(): readonly PostStatus[] {
    return [PostStatus.DRAFT, PostStatus.AWAITING_APPROVAL];
  }

  /** DB の記録（post_current.status）から復元する。知らない値は例外（画面にエラーとして出す） */
  static from(code: string): PostStatus {
    const found = PostStatus.all().find((s) => s.code === code);
    if (!found) throw new Error(`知らない投稿状態です: ${code}`);
    return found;
  }

  canTransitTo(next: PostStatus): boolean {
    return PostStatus.TRANSITIONS[this.code].includes(next.code);
  }

  /** 編集できるのは下書きだけ（承認依頼以降は版が固定される） */
  isEditable(): boolean {
    return this === PostStatus.DRAFT;
  }

  isFailed(): boolean {
    return this === PostStatus.FAILED;
  }

  isPublished(): boolean {
    return this === PostStatus.PUBLISHED;
  }

  /** カレンダーでの色区分（REQ-001 設計 3章 S-02） */
  calendarColor(): string {
    return this.color;
  }

  /** カレンダーに載せるか（破棄した投稿は出さない） */
  appearsOnCalendar(): boolean {
    return this !== PostStatus.DISCARDED;
  }
}
