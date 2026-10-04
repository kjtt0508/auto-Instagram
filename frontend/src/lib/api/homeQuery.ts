import { Alert } from "@/domain/alert/Alert";
import { InstagramConnection } from "@/domain/connection/InstagramConnection";
import { BatchHeartbeat } from "@/domain/job/BatchHeartbeat";
import type { Post } from "@/domain/post/Post";
import { PostStatus } from "@/domain/post/PostStatus";
import { imageGenerationUsage } from "./imageGenerationApi";
import { POST_COLUMNS, toPost, type PostRow } from "./postRepository";
import { supabase, unwrap } from "./supabase";

// ホーム（S-02）の参照: 警告・投稿カレンダー・対応待ちの投稿

/** Instagram連携の状態（トークンそのものは返らない。AC-001-03） */
export async function connectionStatus(): Promise<InstagramConnection | null> {
  const rows = unwrap(await supabase().rpc("instagram_connection_status")) as ConnectionRow[];
  const row = rows[0];
  if (!row) return null;
  return InstagramConnection.restore({ igUsername: row.ig_username, tokenExpiresAt: new Date(row.token_expires_at),
    lastRefreshFailedAt: row.last_refresh_failed_at ? new Date(row.last_refresh_failed_at) : null });
}

type ConnectionRow = { ig_username: string; token_expires_at: string; last_refresh_failed_at: string | null };

/** いま出すべき警告（BR-001-12。記録から導出し保存しない） */
export async function currentAlerts(now: Date) {
  const [connection, heartbeat, failed, usage] = await Promise.all([connectionStatus(), latestTickHeartbeat(), failedPostIds(),
    imageGenerationUsage()]);
  return Alert.detect({ connection, latestHeartbeat: heartbeat, failedPostIds: failed, imageGenerationUsage: usage }, now);
}

async function latestTickHeartbeat(): Promise<BatchHeartbeat | null> {
  const rows = unwrap(await supabase().from("batch_heartbeats").select("at").eq("workflow", "tick")
    .order("at", { ascending: false }).limit(1));
  return rows[0] ? BatchHeartbeat.of(new Date(rows[0].at)) : null;
}

async function failedPostIds(): Promise<string[]> {
  const rows = unwrap(await supabase().from("post_current").select("post_id").eq("status", PostStatus.FAILED.code));
  return rows.map((r) => r.post_id);
}

/** 月の投稿カレンダー: 予約日時か公開日時がその月にある投稿（日本時間の月） */
export async function postsInMonth(year: number, month: number): Promise<Post[]> {
  const from = new Date(Date.UTC(year, month - 1, 1, -9)).toISOString();
  const to = new Date(Date.UTC(year, month, 1, -9)).toISOString();
  const rows = unwrap(await supabase().from("post_current").select(POST_COLUMNS)
    .or(`and(scheduled_at.gte.${from},scheduled_at.lt.${to}),and(published_at.gte.${from},published_at.lt.${to})`)
    .returns<PostRow[]>());
  return rows.map((r) => toPost(r)).filter((p) => p.status.appearsOnCalendar());
}

/** 日付の無い、対応待ちの投稿（下書き・承認待ち） */
export async function postsAwaitingWork(): Promise<Post[]> {
  const rows = unwrap(await supabase().from("post_current").select(POST_COLUMNS)
    .in("status", PostStatus.awaitingWork().map((s) => s.code)).order("status_changed_at", { ascending: false }).returns<PostRow[]>());
  return rows.map((r) => toPost(r));
}
