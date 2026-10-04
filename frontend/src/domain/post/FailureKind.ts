/** 失敗区分: 失敗の種類。画面では対処方法（guidance）を出す。文言は Java の FailureKind と揃える */
export class FailureKind {
  static readonly TRANSIENT = new FailureKind("TRANSIENT", "一時的なエラー", "一時的なエラーです。再実行してください");
  static readonly RATE_LIMITED = new FailureKind("RATE_LIMITED", "上限超過",
    "Instagramの投稿数の上限に達しています。時間を置いて自動で再試行します");
  static readonly TOKEN_INVALID = new FailureKind("TOKEN_INVALID", "連携切れ",
    "Instagram連携が切れています。設定画面から連携をやり直してください");
  static readonly MEDIA_REJECTED = new FailureKind("MEDIA_REJECTED", "画像・内容の不備",
    "画像や内容に不備があります。下書きに戻して直してください");
  static readonly GRACE_EXCEEDED = new FailureKind("GRACE_EXCEEDED", "公開猶予切れ",
    "公開予定から時間が経ちすぎました。日時を決めて再実行してください");
  static readonly RENDER_FAILED = new FailureKind("RENDER_FAILED", "画像化の失敗",
    "画像化に失敗しました。今すぐ再実行でやり直せます");
  static readonly UNKNOWN = new FailureKind("UNKNOWN", "不明",
    "原因が分かりません。Instagramで公開されていないか確認してから再実行してください");

  private constructor(
    readonly code: string,
    readonly label: string,
    readonly guidance: string,
  ) {}

  static all(): readonly FailureKind[] {
    return [FailureKind.TRANSIENT, FailureKind.RATE_LIMITED, FailureKind.TOKEN_INVALID,
      FailureKind.MEDIA_REJECTED, FailureKind.GRACE_EXCEEDED, FailureKind.RENDER_FAILED, FailureKind.UNKNOWN];
  }

  static from(code: string): FailureKind {
    return FailureKind.all().find((k) => k.code === code) ?? FailureKind.UNKNOWN;
  }

  /** 対処に Instagram 連携のやり直しが要るか（設定画面へのリンクを出す） */
  needsReconnection(): boolean {
    return this === FailureKind.TOKEN_INVALID;
  }
}
