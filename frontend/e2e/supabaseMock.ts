import type { Page, Route } from "@playwright/test";

// E2E 用の Supabase の代役。ログイン済みのセッションを置き、REST・RPC の応答を返し、呼ばれた RPC を記録する
const SUPABASE = "https://e2e.supabase.test";
const MINUTE_MS = 60 * 1000;

export type MockPost = {
  id: string; status: string; scheduledAt?: Date; publishedAt?: Date; failure?: { kind: string; message: string };
  generatedStyle?: "ILLUSTRATION" | "PHOTOREALISTIC"; // 1枚目が生成画像（REQ-005）
};
export type MockWorld = {
  role: "ADMIN" | "APPROVER" | "EDITOR"; heartbeatMinutesAgo: number; posts: MockPost[];
  imageGenerationsUsed?: number; // 今日の画像生成の回数（上限20回・警告0.8）
  styleSettings?: boolean; // 投稿の型の設定がある（REQ-002）
  backgroundPhotos?: { id: string; path: string; description: string }[]; // 使っている背景写真（REQ-002）
};

/** 画像の代わりに返す 1×1 の PNG（署名付き URL の先） */
const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE_MS);

export async function useMockSupabase(page: Page, world: MockWorld): Promise<{ rpcCalls: string[] }> {
  const rpcCalls: string[] = [];
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: "sb-e2e-auth-token",
    session: { access_token: "e2e", refresh_token: "e2e", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-1", email: "approver@example.com", aud: "authenticated" } },
  });
  await page.route(`${SUPABASE}/**`, (route) => respond(route, world, rpcCalls));
  return { rpcCalls };
}

function respond(route: Route, world: MockWorld, rpcCalls: string[]) {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/storage/v1/")) return storage(route, url);
  const path = url.pathname.replace("/rest/v1/", "");
  if (path.startsWith("rpc/")) {
    rpcCalls.push(path.slice(4));
    if (path === "rpc/save_post_revision") return json(route, [{ post_id: "new-post", revision_id: "new-post-r1" }]);
    if (path === "rpc/image_generation_usage") {
      return json(route, [{ used: world.imageGenerationsUsed ?? 0, daily_limit: 20, warn_ratio: 0.8 }]);
    }
    return json(route, path === "rpc/instagram_connection_status" ? [connection()] : null);
  }
  const rows = tableRows(path, url, world);
  const wantsObject = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
  return json(route, wantsObject ? rows[0] ?? null : rows);
}

/** Storage: 署名付き URL の発行（パスごとに URL を返す）・その URL の画像・保存 */
function storage(route: Route, url: URL) {
  const request = route.request();
  if (url.pathname.startsWith("/storage/v1/object/sign/uploads-private/") && request.method() === "GET") {
    return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL_PNG });
  }
  if (url.pathname === "/storage/v1/object/sign/uploads-private" && request.method() === "POST") {
    const paths = (request.postDataJSON() as { paths: string[] }).paths;
    return json(route, paths.map((p) => ({ path: p, signedURL: `/object/sign/uploads-private/${p}?token=e2e`, error: null })));
  }
  return json(route, { Key: "uploads-private/e2e" });
}

function tableRows(table: string, url: URL, world: MockWorld): unknown[] {
  if (table === "post_style_settings_current") return world.styleSettings ? [STYLE_ROW] : [];
  if (table === "usable_background_photos") {
    return (world.backgroundPhotos ?? []).map((p) => ({ id: p.id, storage_path: p.path, description: p.description }));
  }
  if (table === "member_current") {
    return [{ member_id: "m1", tenant_id: "t1", email: "approver@example.com", display_name: "承認者", role: world.role, active: true }];
  }
  if (table === "tenants") return [{ id: "t1", name: "新島info" }];
  if (table === "tenant_settings_current") return [{ pr_label: "【PR】\n" }];
  if (table === "batch_heartbeats") return [{ at: minutesFromNow(-world.heartbeatMinutesAgo).toISOString() }];
  if (table === "post_media_origin") return mediaRows(url, world);
  if (table === "post_media" || table === "post_events") return [];
  if (table === "post_current") return postRows(url, world);
  return [];
}

function postRows(url: URL, world: MockWorld): unknown[] {
  const statusFilter = url.searchParams.get("status");
  const idFilter = url.searchParams.get("post_id");
  return world.posts
    .filter((p) => !idFilter || idFilter === `eq.${p.id}`)
    .filter((p) => !statusFilter || statusFilter.includes(p.status))
    .filter((p) => statusFilter || idFilter || p.scheduledAt || p.publishedAt)
    .map(toPostRow);
}

/** 生成画像を含む投稿だけ、1枚目を生成画像として返す（それ以外の投稿は画像なし） */
function mediaRows(url: URL, world: MockWorld): unknown[] {
  const post = world.posts.find((p) => url.searchParams.get("revision_id") === `eq.${p.id}-r1`);
  if (!post?.generatedStyle) return [];
  return [{ position: 1, storage_path: `t1/posts/${post.id}.jpg`, width: 1080, height: 1350, byte_size: 400000,
    generation_id: "g1", candidate_position: 1, style: post.generatedStyle }];
}

const toPostRow = (p: MockPost) => ({
  post_id: p.id, status: p.status, revision_id: `${p.id}-r1`, format: "FEED_IMAGE", caption: `${p.id} のキャプション`,
  pr_category: "NONE", genre_id: null, scheduled_at: p.scheduledAt?.toISOString() ?? null,
  ig_media_id: p.publishedAt ? "1790" : null, permalink: p.publishedAt ? "https://www.instagram.com/p/x/" : null,
  published_at: p.publishedAt?.toISOString() ?? null,
  last_failure_kind: p.failure?.kind ?? null, last_failure_message: p.failure?.message ?? null,
});

const STYLE_ROW = {
  id: 1, tenant_id: "t1", version: 1, band_text: "新島info", cover_targets: ["同志社大学", "同志社大生"],
  closing_message: "ご覧いただきありがとうございます", account_introduction: "@niijima_info\n学生生活を発信中",
  caption_footer: "──────\n新島info", fixed_hashtags: ["#新島info", "#同志社"],
};

const connection = () => ({
  ig_username: "niijima_info", connected_at: minutesFromNow(-60 * 24).toISOString(),
  token_expires_at: minutesFromNow(60 * 24 * 50).toISOString(), last_refresh_failed_at: null,
});

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
