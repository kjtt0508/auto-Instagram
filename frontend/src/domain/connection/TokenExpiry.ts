/** トークン有効期限。更新・警告・ワークフローを失敗させる日数（30/14/7日・仮置き）。Java の TokenExpiry と揃える */
export class TokenExpiry {
  static readonly REFRESH_DAYS = 30;
  static readonly WARNING_DAYS = 14;
  static readonly FAIL_WORKFLOW_DAYS = 7;
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  private constructor(private readonly expiresAt: Date) {}

  static of(expiresAt: Date): TokenExpiry {
    if (Number.isNaN(expiresAt.getTime())) throw new Error("トークン有効期限は必須です");
    return new TokenExpiry(expiresAt);
  }

  /** 残り日数（切り捨て。期限切れなら0以下） */
  remainingDays(now: Date): number {
    return Math.trunc((this.expiresAt.getTime() - now.getTime()) / TokenExpiry.DAY_MS);
  }

  needsRefresh(now: Date): boolean {
    return this.remainingDays(now) <= TokenExpiry.REFRESH_DAYS;
  }

  needsWarning(now: Date): boolean {
    return this.remainingDays(now) <= TokenExpiry.WARNING_DAYS;
  }

  shouldFailWorkflow(refreshFailed: boolean, now: Date): boolean {
    return refreshFailed && this.remainingDays(now) <= TokenExpiry.FAIL_WORKFLOW_DAYS;
  }

  toDate(): Date {
    return new Date(this.expiresAt.getTime());
  }
}
