import { describe, expect, it } from "vitest";
import { InstagramConnection } from "../connection/InstagramConnection";
import { ImageGenerationQuota } from "../image/ImageGenerationQuota";
import { ImageGenerationUsage } from "../image/ImageGenerationUsage";
import { BatchHeartbeat } from "../job/BatchHeartbeat";
import { Alert } from "./Alert";

const now = new Date("2026-10-02T01:00:00Z");
const minutesAgo = (m: number) => BatchHeartbeat.of(new Date(now.getTime() - m * 60 * 1000));
const daysLater = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
const connection = (expiresInDays: number, refreshFailed = false) => InstagramConnection.restore({
  igUsername: "niijima_info", tokenExpiresAt: daysLater(expiresInDays),
  lastRefreshFailedAt: refreshFailed ? now : null,
});
const codes = (records: Parameters<typeof Alert.detect>[0]) => Alert.detect(records, now).map((a) => a.alert.code);

describe("警告の導出（BR-001-12）", () => {
  it("問題が無ければ警告は出ない", () => {
    expect(codes({ connection: connection(50), latestHeartbeat: minutesAgo(10), failedPostIds: [] })).toEqual([]);
  });

  it("AC-001-21 NFR-001-06 最後のバッチ稼働記録が61分前なら「定期処理が止まっています」", () => {
    const alerts = Alert.detect({ connection: connection(50), latestHeartbeat: minutesAgo(61), failedPostIds: [] }, now);
    expect(alerts.map((a) => a.alert.message)).toEqual(["定期処理が止まっています"]);
  });

  it("NFR-001-06 59分前ならまだ警告しない。60分ちょうどで警告する", () => {
    expect(codes({ connection: connection(50), latestHeartbeat: minutesAgo(59), failedPostIds: [] })).toEqual([]);
    expect(codes({ connection: connection(50), latestHeartbeat: minutesAgo(60), failedPostIds: [] })).toEqual(["BATCH_STOPPED"]);
  });

  it("稼働記録が1件も無ければ止まっているとみなす", () => {
    expect(codes({ connection: connection(50), latestHeartbeat: null, failedPostIds: [] })).toEqual(["BATCH_STOPPED"]);
  });

  it("AC-001-20 トークン更新に失敗していたら「トークン更新失敗」", () => {
    const alerts = Alert.detect({ connection: connection(7, true), latestHeartbeat: minutesAgo(1), failedPostIds: [] }, now);
    expect(alerts[0].alert.message).toContain("トークン更新失敗");
    expect(alerts.map((a) => a.alert.code)).toEqual(["TOKEN_REFRESH_FAILED", "TOKEN_EXPIRING"]);
  });

  it("未連携ならエラー。失敗した投稿があればその投稿へのリンク", () => {
    const alerts = Alert.detect({ connection: null, latestHeartbeat: minutesAgo(1), failedPostIds: ["p1", "p2"] }, now);
    expect(alerts.map((a) => [a.alert.code, a.href])).toEqual([
      ["CONNECTION_MISSING", "/settings/"],
      ["PUBLISH_FAILED", "/posts/view/?id=p1"],
    ]);
  });

  it("AC-005-06 画像生成の回数が上限20回の8割（16回）に近づいたら注意、20回で到達。15回までは出さない", () => {
    const withUsage = (used: number) => codes({ connection: connection(50), latestHeartbeat: minutesAgo(1), failedPostIds: [],
      imageGenerationUsage: ImageGenerationUsage.of(used, ImageGenerationQuota.of(20, 0.8)) });
    expect(withUsage(15)).toEqual([]);
    expect(withUsage(16)).toEqual(["IMAGE_LIMIT_NEAR"]);
    expect(withUsage(19)).toEqual(["IMAGE_LIMIT_NEAR"]);
    expect(withUsage(20)).toEqual(["IMAGE_LIMIT_REACHED"]);
  });

  it("エラーが注意より先に並ぶ", () => {
    const alerts = Alert.detect({ connection: connection(10), latestHeartbeat: minutesAgo(90), failedPostIds: [] }, now);
    expect(alerts.map((a) => a.alert.code)).toEqual(["BATCH_STOPPED", "TOKEN_EXPIRING"]);
  });
});
