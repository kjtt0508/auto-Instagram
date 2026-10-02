import type { Page, Route } from "@playwright/test";

// E2E 用の Supabase の代役。ログイン済みのセッションを置き、REST・RPC の応答を返し、呼ばれた RPC を記録する
const SUPABASE = "https://e2e.supabase.test";
const MINUTE_MS = 60 * 1000;

export type MockPost = { id: string; status: string; scheduledAt?: Date; publishedAt?: Date; failure?: { kind: string; message: string } };
export type MockWorld = { role: "ADMIN" | "APPROVER" | "EDITOR"; heartbeatMinutesAgo: number; posts: MockPost[] };

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
  const path = url.pathname.replace("/rest/v1/", "");
  if (path.startsWith("rpc/")) {
    rpcCalls.push(path.slice(4));
    if (path === "rpc/save_post_revision") return json(route, [{ post_id: "new-post", revision_id: "new-post-r1" }]);
    return json(route, path === "rpc/instagram_connection_status" ? [connection()] : null);
  }
  const rows = tableRows(path, url, world);
  const wantsObject = (route.request().headers()["accept"] ?? "").includes("vnd.pgrst.object");
  return json(route, wantsObject ? rows[0] ?? null : rows);
}

function tableRows(table: string, url: URL, world: MockWorld): unknown[] {
  if (table === "member_current") {
    return [{ member_id: "m1", tenant_id: "t1", email: "approver@example.com", display_name: "承認者", role: world.role, active: true }];
  }
  if (table === "tenants") return [{ id: "t1", name: "新島info" }];
  if (table === "tenant_settings_current") return [{ pr_label: "【PR】\n" }];
  if (table === "batch_heartbeats") return [{ at: minutesFromNow(-world.heartbeatMinutesAgo).toISOString() }];
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

const toPostRow = (p: MockPost) => ({
  post_id: p.id, status: p.status, revision_id: `${p.id}-r1`, format: "FEED_IMAGE", caption: `${p.id} のキャプション`,
  pr_category: "NONE", genre_id: null, scheduled_at: p.scheduledAt?.toISOString() ?? null,
  ig_media_id: p.publishedAt ? "1790" : null, permalink: p.publishedAt ? "https://www.instagram.com/p/x/" : null,
  published_at: p.publishedAt?.toISOString() ?? null,
  last_failure_kind: p.failure?.kind ?? null, last_failure_message: p.failure?.message ?? null,
});

const connection = () => ({
  ig_username: "niijima_info", connected_at: minutesFromNow(-60 * 24).toISOString(),
  token_expires_at: minutesFromNow(60 * 24 * 50).toISOString(), last_refresh_failed_at: null,
});

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
