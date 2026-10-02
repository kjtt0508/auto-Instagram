// 手元で画面を見るためのデモ用の偽 Supabase（本番では使わない）。データはメモリだけに置き、止めると消える
// 認証（ロールを選んでログイン）・REST・RPC・Storage のうち、管理画面が使う範囲だけを真似る
import http from "node:http";
import { randomUUID } from "node:crypto";

export const DEMO_PORT = 54321;
const TENANT = "00000000-0000-4000-8000-000000000001";
const MIN = 60 * 1000;
const at = (minutes) => new Date(Date.now() + minutes * MIN).toISOString();

// ───────── データ ─────────
const members = [
  { member_id: "m-admin", tenant_id: TENANT, email: "admin@example.com", display_name: "京愛（管理者）", role: "ADMIN", active: true },
  { member_id: "m-approver", tenant_id: TENANT, email: "approver@example.com", display_name: "新島info 幹部", role: "APPROVER", active: true },
  { member_id: "m-editor", tenant_id: TENANT, email: "editor@example.com", display_name: "新島info 運営", role: "EDITOR", active: true },
];
const users = { ADMIN: "m-admin", APPROVER: "m-approver", EDITOR: "m-editor", STRANGER: null };
let connection = { ig_username: "niijima_info", connected_at: at(-60 * 24 * 10), token_expires_at: at(60 * 24 * 50), last_refresh_failed_at: null };
const files = new Map();
const posts = [];

function addPost({ status, caption, format = "FEED_IMAGE", pr = "NONE", count = 1, scheduled, published, failure, by = "m-editor" }) {
  const id = randomUUID();
  const revision = { id: randomUUID(), no: 1, format, caption, pr_category: pr,
    media: Array.from({ length: count }, (_, i) => ({ position: i + 1, storage_path: `${TENANT}/posts/sample-${id}-${i + 1}.jpg`, width: 1080, height: 1350, byte_size: 400000 })) };
  const post = { id, created_by: by, revisions: [revision], events: [], status: "DRAFT", scheduled_at: null, published: null, failure: null };
  post.events.push({ event_type: "CREATED", to_status: "DRAFT", actor: by, occurred_at: at(-600) });
  const path = { AWAITING_APPROVAL: ["APPROVAL_REQUESTED"], SCHEDULED: ["APPROVAL_REQUESTED", "APPROVED"],
    PUBLISHED: ["APPROVAL_REQUESTED", "APPROVED", "PUBLISH_STARTED", "PUBLISHED"], FAILED: ["APPROVAL_REQUESTED", "APPROVED", "FAILED"] }[status] ?? [];
  const to = { APPROVAL_REQUESTED: "AWAITING_APPROVAL", APPROVED: "SCHEDULED", PUBLISH_STARTED: "PUBLISHING", PUBLISHED: "PUBLISHED", FAILED: "FAILED" };
  path.forEach((e, i) => post.events.push({ event_type: e, to_status: to[e], actor: e.startsWith("PUBLISH") || e === "FAILED" ? null : "m-approver", occurred_at: at(-500 + i * 10) }));
  Object.assign(post, { status, scheduled_at: scheduled ?? null, published: published ?? null, failure: failure ?? null });
  posts.push(post);
}

addPost({ status: "DRAFT", caption: "学園祭の模擬店まとめ（下書き）\n#新島info #同志社" });
addPost({ status: "AWAITING_APPROVAL", caption: "11/3 学園祭のお知らせ\n今年は今出川キャンパスで開催します！\n#新島info #学園祭", count: 3, format: "CAROUSEL" });
addPost({ status: "SCHEDULED", caption: "図書館の試験期間の開館時間\n#新島info", scheduled: at(60 * 5) });
addPost({ status: "SCHEDULED", caption: "サークル紹介：写真部\n#新島info", scheduled: at(60 * 24 * 3) });
addPost({ status: "PUBLISHED", caption: "新歓イベントのレポート\n#新島info", scheduled: at(-60 * 24 * 2), published: { ig_media_id: "1790", permalink: "https://www.instagram.com/", published_at: at(-60 * 24 * 2 + 5) } });
addPost({ status: "FAILED", caption: "【PR】カフェの新メニュー紹介\n#新島info", pr: "PR", scheduled: at(-90),
  failure: { kind: "TOKEN_INVALID", message: "Instagramのトークンが無効です（code 190）" } });

// ───────── 読み取り（REST） ─────────
const latest = (p) => p.revisions[p.revisions.length - 1];
const currentRow = (p) => {
  const r = latest(p);
  return { post_id: p.id, tenant_id: TENANT, created_by: p.created_by, status: p.status, status_changed_at: p.events.at(-1).occurred_at,
    revision_id: r.id, revision_no: r.no, format: r.format, media_source: "UPLOAD", caption: r.caption, pr_category: r.pr_category, genre_id: null,
    approved_revision_id: r.id, scheduled_at: p.scheduled_at, ig_media_id: p.published?.ig_media_id ?? null,
    permalink: p.published?.permalink ?? null, published_at: p.published?.published_at ?? null,
    last_failure_kind: p.failure?.kind ?? null, last_failure_message: p.failure?.message ?? null };
};
const memberName = (id) => members.find((m) => m.member_id === id)?.display_name ?? null;

function tableRows(table, me) {
  if (!me) return [];
  if (table === "member_current") {
    const authUserOf = (memberId) => Object.entries(users).find(([, id]) => id === memberId)?.[0];
    return members.map((m) => ({ ...m, auth_user_id: authUserOf(m.member_id) ? `user-${authUserOf(m.member_id)}` : null }));
  }
  if (table === "tenants") return [{ id: TENANT, name: "新島info" }];
  if (table === "tenant_settings_current") return [{ tenant_id: TENANT, pr_label: "【PR】\n" }];
  if (table === "batch_heartbeats") return [{ workflow: "tick", at: at(-4) }];
  if (table === "post_current") return posts.filter((p) => p.status !== "DISCARDED" || true).map(currentRow);
  if (table === "post_media") return posts.flatMap((p) => p.revisions.flatMap((r) => r.media.map((m) => ({ ...m, revision_id: r.id }))));
  if (table === "post_events") return posts.flatMap((p) => p.events.map((e) => ({ ...e, post_id: p.id, note: null, actor: e.actor ? { display_name: memberName(e.actor) } : null })));
  return [];
}

// PostgREST の簡単なフィルタ（eq. / in.() / is.）だけを解く
function applyFilters(rows, params) {
  const range = (params.get("or") ?? "").match(/gte\.([^,)]+),\w+\.lt\.([^,)]+)/);
  const inRange = (v) => v && (!range || (v >= range[1] && v < range[2]));
  return rows.filter((row) => !range || inRange(row.scheduled_at) || inRange(row.published_at)).filter((row) => [...params].every(([key, value]) => {
    if (["select", "order", "limit", "or", "offset"].includes(key)) return true;
    if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
    if (value === "is.true") return row[key] === true;
    return true;
  }));
}

// ───────── 書き込み（RPC） ─────────
class RpcError extends Error { constructor(code, message) { super(message); this.code = code; } }
const requireRole = (me, roles) => { if (!me || !roles.includes(me.role)) throw new RpcError("42501", "権限がありません"); };
const findPost = (id) => posts.find((p) => p.id === id) ?? (() => { throw new RpcError("P0404", "投稿が見つかりません"); })();
function transit(post, me, eventType, from, to) {
  if (!from.includes(post.status)) throw new RpcError("P0409", `post is ${post.status}`);
  post.events.push({ event_type: eventType, to_status: to, actor: me.member_id, occurred_at: new Date().toISOString() });
  post.status = to;
}

const rpcs = {
  link_my_member: () => null,
  instagram_connection_status: () => (connection ? [connection] : []),
  save_post_revision: (me, { p_post, p_revision }) => {
    requireRole(me, ["ADMIN", "APPROVER", "EDITOR"]);
    let post = p_post ? findPost(p_post) : null;
    const revision = { id: randomUUID(), no: post ? latest(post).no + 1 : 1, format: p_revision.format, caption: p_revision.caption,
      pr_category: p_revision.prCategory, media: p_revision.media.map((m) => ({ position: m.position, storage_path: m.storagePath, width: m.width, height: m.height, byte_size: m.byteSize })) };
    if (post && post.status !== "DRAFT") throw new RpcError("P0409", "revisions are frozen");
    if (!post) {
      post = { id: randomUUID(), created_by: me.member_id, revisions: [], events: [], status: "DRAFT", scheduled_at: null, published: null, failure: null };
      post.events.push({ event_type: "CREATED", to_status: "DRAFT", actor: me.member_id, occurred_at: new Date().toISOString() });
      posts.push(post);
    }
    post.revisions.push(revision);
    return [{ post_id: post.id, revision_id: revision.id }];
  },
  request_approval: (me, { p_post }) => transit(findPost(p_post), me, "APPROVAL_REQUESTED", ["DRAFT"], "AWAITING_APPROVAL"),
  approve_post: (me, { p_post, p_scheduled_at }) => {
    requireRole(me, ["ADMIN", "APPROVER"]);
    const post = findPost(p_post);
    transit(post, me, "APPROVED", ["AWAITING_APPROVAL"], "SCHEDULED");
    post.scheduled_at = p_scheduled_at;
  },
  retry_post: (me, { p_post, p_scheduled_at }) => {
    requireRole(me, ["ADMIN", "APPROVER"]);
    const post = findPost(p_post);
    transit(post, me, "RETRIED", ["FAILED"], "SCHEDULED");
    Object.assign(post, { scheduled_at: p_scheduled_at, failure: null });
  },
  send_back_to_draft: (me, { p_post }) => { requireRole(me, ["ADMIN", "APPROVER"]); transit(findPost(p_post), me, "REVISION_REQUESTED", ["AWAITING_APPROVAL"], "DRAFT"); },
  cancel_schedule: (me, { p_post }) => { requireRole(me, ["ADMIN", "APPROVER"]); transit(findPost(p_post), me, "SCHEDULE_CANCELLED", ["SCHEDULED"], "DRAFT"); },
  return_to_draft: (me, { p_post }) => { requireRole(me, ["ADMIN", "APPROVER"]); transit(findPost(p_post), me, "RETURNED_TO_DRAFT", ["FAILED"], "DRAFT"); },
  discard_post: (me, { p_post }) => {
    const post = findPost(p_post);
    if (post.status !== "DRAFT") requireRole(me, ["ADMIN", "APPROVER"]);
    transit(post, me, "DISCARDED", ["DRAFT", "AWAITING_APPROVAL", "FAILED"], "DISCARDED");
  },
  invite_member: (me, { p_email, p_display_name, p_role }) => {
    requireRole(me, ["ADMIN", "APPROVER"]);
    if (p_role === "ADMIN" && me.role !== "ADMIN") throw new RpcError("42501", "管理者ロールは管理者だけが扱えます");
    members.push({ member_id: randomUUID(), tenant_id: TENANT, email: p_email, display_name: p_display_name, role: p_role, active: true });
  },
  change_member_role: (me, { p_member, p_role }) => {
    requireRole(me, ["ADMIN", "APPROVER"]);
    if (p_member === me.member_id) throw new RpcError("22023", "自分自身のロールは変えられません");
    members.find((m) => m.member_id === p_member).role = p_role;
  },
  deactivate_member: (me, { p_member }) => {
    requireRole(me, ["ADMIN", "APPROVER"]);
    members.find((m) => m.member_id === p_member).active = false;
  },
  disconnect_instagram: (me) => { requireRole(me, ["ADMIN"]); connection = null; },
};

// ───────── 認証 ─────────
const session = (role) => ({ access_token: `demo-${role}`, refresh_token: `demo-${role}`, token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: `user-${role}`, aud: "authenticated", role: "authenticated", email: `${role.toLowerCase()}@example.com`, user_metadata: { email_verified: true } } });
const memberOf = (req) => {
  const role = (req.headers.authorization ?? "").match(/Bearer demo-(\w+)/)?.[1];
  const id = role && users[role];
  const m = members.find((x) => x.member_id === id && x.active);
  return m ?? null;
};
const chooser = (redirectTo) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<body style="font-family:-apple-system,sans-serif;background:#f2f2f7;padding:24px;max-width:420px;margin:auto">
<h2>デモ: Google でログイン</h2><p style="color:#666">どのロールでログインするか選びます（本番では Google の画面になります）</p>
${[["ADMIN", "管理者（京愛）"], ["APPROVER", "承認者（新島info 幹部）"], ["EDITOR", "編集者（新島info 運営）"], ["STRANGER", "許可リストに無い人"]]
    .map(([r, l]) => `<a href="${redirectTo}${redirectTo.includes("?") ? "&" : "?"}code=${r}" style="display:block;background:#fff;border-radius:10px;padding:14px 16px;margin:8px 0;color:#007aff;text-decoration:none">${l}</a>`).join("")}`;

// ───────── サーバ ─────────
const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Expose-Headers": "*" });
  res.end(body === null ? "" : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => resolve(Buffer.concat(chunks))); });
const placeholder = (path) => `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="hsl(${[...path].reduce((a, c) => a + c.charCodeAt(0), 0) % 360},55%,70%)"/><text x="50%" y="50%" font-size="72" text-anchor="middle" fill="#fff" font-family="sans-serif">サンプル画像</text></svg>`;

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${DEMO_PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204, null);
  if (path === "/auth/v1/authorize") return send(res, 200, chooser(url.searchParams.get("redirect_to") ?? "http://localhost:3000/"), "text/html; charset=utf-8");
  if (path === "/auth/v1/token") {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const role = (body.auth_code ?? body.refresh_token ?? "").replace("demo-", "");
    return send(res, 200, session(role in users ? role : "STRANGER"));
  }
  if (path === "/auth/v1/user") return send(res, 200, session((req.headers.authorization ?? "").replace("Bearer demo-", "")).user);
  if (path === "/auth/v1/logout") return send(res, 204, null);
  const me = memberOf(req);
  if (path.startsWith("/rest/v1/rpc/")) {
    const name = path.slice("/rest/v1/rpc/".length);
    try {
      const result = rpcs[name]?.(me, JSON.parse((await readBody(req)).toString() || "{}"));
      return send(res, 200, result ?? null);
    } catch (e) {
      return send(res, 400, { code: e.code ?? "XX000", message: e.message, details: null, hint: null });
    }
  }
  if (path.startsWith("/rest/v1/")) {
    const rows = applyFilters(tableRows(path.slice("/rest/v1/".length), me), url.searchParams);
    const wantsObject = (req.headers.accept ?? "").includes("vnd.pgrst.object");
    return send(res, 200, wantsObject ? rows[0] ?? null : rows);
  }
  if (path.startsWith("/storage/v1/object/sign/") && req.method === "POST") {
    const { paths } = JSON.parse((await readBody(req)).toString());
    return send(res, 200, paths.map((p) => ({ path: p, signedURL: `/object/sign/uploads-private/${p}?token=demo`, error: null })));
  }
  if (path.startsWith("/storage/v1/object/sign/uploads-private/")) {
    const key = decodeURIComponent(path.slice("/storage/v1/object/sign/uploads-private/".length));
    return files.has(key) ? send(res, 200, files.get(key), "image/jpeg") : send(res, 200, placeholder(key), "image/svg+xml");
  }
  if (path.startsWith("/storage/v1/object/uploads-private/") && req.method === "POST") {
    const key = decodeURIComponent(path.slice("/storage/v1/object/uploads-private/".length));
    files.set(key, await readBody(req));
    return send(res, 200, { Key: `uploads-private/${key}`, Id: randomUUID() });
  }
  return send(res, 404, { message: `demo: ${req.method} ${path} は未対応です` });
}

export function startDemoSupabase() {
  return http.createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { message: e.message }))).listen(DEMO_PORT);
}
