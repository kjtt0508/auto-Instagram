/** バッチ稼働記録: 定期処理（tick）が動いたことの記録。最後の記録から60分以上経てば止まっているとみなす（BR-001-12） */
export class BatchHeartbeat {
  static readonly STOPPED_AFTER_MINUTES = 60;
  private static readonly MINUTE_MS = 60 * 1000;

  private constructor(private readonly recordedAt: Date) {}

  static of(recordedAt: Date): BatchHeartbeat {
    if (Number.isNaN(recordedAt.getTime())) throw new Error("稼働記録の日時は必須です");
    return new BatchHeartbeat(recordedAt);
  }

  /** 定期処理が止まっているか（記録がまったく無いときも止まっているとみなすのは警告の側で判断する） */
  indicatesStopped(now: Date): boolean {
    return now.getTime() - this.recordedAt.getTime() >= BatchHeartbeat.STOPPED_AFTER_MINUTES * BatchHeartbeat.MINUTE_MS;
  }
}
