import type { InstagramConnection } from "../connection/InstagramConnection";
import type { ImageGenerationUsage } from "../image/ImageGenerationUsage";
import type { BatchHeartbeat } from "../job/BatchHeartbeat";

/**
 * 警告: ログイン時にバナーで出す警告の種類（BR-001-12）。記録から導出し、保存しない。
 * 画像生成の上限（IMAGE_LIMIT_NEAR / REACHED）は REQ-005。生成上限（LLM_LIMIT_NEAR / REACHED）は REQ-002 で足す。
 */
export class Alert {
  static readonly CONNECTION_MISSING = new Alert("CONNECTION_MISSING", "Instagramと連携していません。設定画面から連携してください", "ERROR");
  static readonly TOKEN_REFRESH_FAILED = new Alert("TOKEN_REFRESH_FAILED", "トークン更新失敗: Instagram連携をやり直してください", "ERROR");
  static readonly TOKEN_EXPIRING = new Alert("TOKEN_EXPIRING", "Instagram連携の期限が近づいています", "WARNING");
  static readonly PUBLISH_FAILED = new Alert("PUBLISH_FAILED", "公開に失敗した投稿があります", "ERROR");
  static readonly BATCH_STOPPED = new Alert("BATCH_STOPPED", "定期処理が止まっています", "ERROR");
  static readonly IMAGE_LIMIT_NEAR = new Alert("IMAGE_LIMIT_NEAR", "今日の画像生成の上限が近づいています", "WARNING");
  static readonly IMAGE_LIMIT_REACHED = new Alert("IMAGE_LIMIT_REACHED",
    "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください", "WARNING");

  private constructor(
    readonly code: string,
    readonly message: string,
    private readonly severity: "ERROR" | "WARNING",
  ) {}

  /** 記録から、いま出すべき警告を重要度順（エラーが先）に返す。href は対処する画面 */
  static detect(records: {
    connection: InstagramConnection | null;
    latestHeartbeat: BatchHeartbeat | null;
    failedPostIds: readonly string[];
    imageGenerationUsage?: ImageGenerationUsage | null;
  }, now: Date): { alert: Alert; href: string }[] {
    const found = [
      ...Alert.connectionAlerts(records.connection, now),
      ...Alert.publishAlerts(records.failedPostIds),
      ...Alert.batchAlerts(records.latestHeartbeat, now),
      ...Alert.imageGenerationAlerts(records.imageGenerationUsage ?? null),
    ];
    return found.sort((a, b) => Number(b.alert.isError()) - Number(a.alert.isError()));
  }

  isError(): boolean {
    return this.severity === "ERROR";
  }

  private static connectionAlerts(connection: InstagramConnection | null, now: Date) {
    const toSettings = (alert: Alert) => ({ alert, href: "/settings/" });
    if (!connection) return [toSettings(Alert.CONNECTION_MISSING)];
    const alerts: Alert[] = [];
    if (connection.refreshFailed()) alerts.push(Alert.TOKEN_REFRESH_FAILED);
    if (connection.needsWarning(now)) alerts.push(Alert.TOKEN_EXPIRING);
    return alerts.map(toSettings);
  }

  private static publishAlerts(failedPostIds: readonly string[]) {
    if (failedPostIds.length === 0) return [];
    return [{ alert: Alert.PUBLISH_FAILED, href: `/posts/view/?id=${encodeURIComponent(failedPostIds[0])}` }];
  }

  private static batchAlerts(latest: BatchHeartbeat | null, now: Date) {
    if (latest && !latest.indicatesStopped(now)) return [];
    return [{ alert: Alert.BATCH_STOPPED, href: "/runbook/" }];
  }

  /** 上限なら到達、上限の8割（警告の割合）以上なら近い（AC-005-06） */
  private static imageGenerationAlerts(usage: ImageGenerationUsage | null) {
    const toNewPost = (alert: Alert) => [{ alert, href: "/posts/new/" }];
    if (!usage) return [];
    if (!usage.canGenerate()) return toNewPost(Alert.IMAGE_LIMIT_REACHED);
    if (usage.isNearLimit()) return toNewPost(Alert.IMAGE_LIMIT_NEAR);
    return [];
  }
}
