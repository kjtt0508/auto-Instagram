import { TokenExpiry } from "./TokenExpiry";

/**
 * Instagram連携（画面から見た姿）: 連携中の IG ユーザー名とトークン有効期限。
 * アクセストークンそのものは画面に来ない（RPC instagram_connection_status は暗号文も返さない。AC-001-03）。
 */
export class InstagramConnection {
  private constructor(
    readonly igUsername: string,
    readonly tokenExpiry: TokenExpiry,
    private readonly lastRefreshFailedAt: Date | null,
  ) {}

  static restore(parts: { igUsername: string; tokenExpiresAt: Date; lastRefreshFailedAt: Date | null }): InstagramConnection {
    if (parts.igUsername.trim() === "") throw new Error("IGユーザー名は必須です");
    return new InstagramConnection(parts.igUsername, TokenExpiry.of(parts.tokenExpiresAt), parts.lastRefreshFailedAt);
  }

  /** 連携できるアカウントの種類か（ビジネス・クリエイターだけが API で投稿できる。02_外部連携設計 1.1） */
  static acceptsAccountType(accountType: string): boolean {
    return InstagramConnection.ACCOUNT_TYPES.includes(accountType);
  }

  private static readonly ACCOUNT_TYPES: readonly string[] = ["BUSINESS", "MEDIA_CREATOR"];

  /** 最後のトークン更新が失敗しているか（成功した更新より後に失敗の記録がある） */
  refreshFailed(): boolean {
    return this.lastRefreshFailedAt !== null;
  }

  /** 人の対応が要るか（期限が近い、または更新に失敗している）。設定画面で赤く示す */
  needsAttention(now: Date): boolean {
    return this.needsWarning(now) || this.refreshFailed();
  }

  needsWarning(now: Date): boolean {
    return this.tokenExpiry.needsWarning(now);
  }

  remainingDays(now: Date): number {
    return this.tokenExpiry.remainingDays(now);
  }
}
