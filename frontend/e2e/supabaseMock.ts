import type { Page, Route } from "@playwright/test";

// E2E 用の Supabase の代役。ログイン済みのセッションを置き、REST・RPC の応答を返し、呼ばれた RPC を記録する
const SUPABASE = "https://e2e.supabase.test";
const MINUTE_MS = 60 * 1000;

export type MockPost = {
  id: string; status: string; scheduledAt?: Date; publishedAt?: Date; failure?: { kind: string; message: string };
  generatedStyle?: "ILLUSTRATION" | "PHOTOREALISTIC"; // 1枚目が生成画像（REQ-005）
  template?: MockTemplate; // テンプレートの投稿（AIで作った投稿。REQ-002）
};

/** テンプレートの投稿の版の中身。強調する語は説明文の中の位置（コードポイント）で持つ（DB と同じ） */
export type MockTemplate = {
  cover: { target: string; keyword: string; annotation: string; closingWords: string; accent: string; backgroundPhotoId?: string };
  bodies: {
    heading: string; description: string; emphases: { start: number; length: number }[]; picturePrompt: string; needsReplacement?: boolean;
    material?: { path: string; style?: "ILLUSTRATION" | "PHOTOREALISTIC" };
  }[];
  hashtags: string[]; generationId?: string; caption?: string;
};
export type MockWorld = {
  role: "ADMIN" | "APPROVER" | "EDITOR"; heartbeatMinutesAgo: number; posts: MockPost[];
  imageGenerationsUsed?: number; // 今日の画像生成の回数（上限20回・警告0.8）
  styleSettings?: boolean; // 投稿の型の設定がある（REQ-002）
  backgroundPhotos?: { id: string; path: string; description: string }[]; // 使っている背景写真（REQ-002）
  styleOverride?: Record<string, unknown>; // 保存された投稿の型の設定（save_post_style_settings の引数）
  styleLogoPath?: string; // 投稿の型の設定の現在の版のロゴ
  styleVersion?: number; // 投稿の型の設定の現在の版（styleSettings が true のとき。既定は 1）
  promptVersions?: { id: string; purpose: "PLAN" | "REVISE"; versionNo: number; body: string }[]; // プロンプト版（REQ-002）
  activePrompts?: Partial<Record<"PLAN" | "REVISE", string>>; // 用途ごとの有効な版の ID
  /** 最初の1回だけ失敗させる RPC（名前 → エラー）。本物の RPC のエラーの形（code・message）で返す */
  failOnce?: Record<string, { code: string; message: string }>;
};

/** 呼ばれた RPC の名前と引数 */
export type RpcCall = { name: string; body: Record<string, unknown> };

/** 画像の代わりに返す 1×1 の PNG（署名付き URL の先） */
const PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE_MS);

export async function useMockSupabase(page: Page, world: MockWorld): Promise<{ rpcCalls: string[]; rpcLog: RpcCall[]; uploads: string[] }> {
  const rpcCalls: string[] = [];
  const rpcLog: RpcCall[] = [];
  const uploads: string[] = [];
  await page.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), {
    key: "sb-e2e-auth-token",
    session: { access_token: "e2e", refresh_token: "e2e", token_type: "bearer", expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "user-1", email: "approver@example.com", aud: "authenticated" } },
  });
  await page.route(`${SUPABASE}/**`, (route) => respond(route, world, { rpcCalls, rpcLog, uploads }));
  return { rpcCalls, rpcLog, uploads };
}

type Records = { rpcCalls: string[]; rpcLog: RpcCall[]; uploads: string[] };

function respond(route: Route, world: MockWorld, records: Records) {
  const { rpcCalls } = records;
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/storage/v1/")) return storage(route, url, records.uploads);
  const path = url.pathname.replace("/rest/v1/", "");
  if (path.startsWith("rpc/")) {
    const name = path.slice(4);
    rpcCalls.push(name);
    records.rpcLog.push({ name, body: (route.request().postDataJSON() ?? {}) as Record<string, unknown> });
    const failure = world.failOnce?.[name];
    if (failure) {
      delete world.failOnce![name];
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify(failure) });
    }
    const administered = administer(name, records.rpcLog.at(-1)!.body, world);
    if (administered !== undefined) return json(route, administered);
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
function storage(route: Route, url: URL, uploads: string[]) {
  const request = route.request();
  if (request.method() === "POST" && url.pathname.startsWith("/storage/v1/object/uploads-private/")) {
    uploads.push(decodeURIComponent(url.pathname.replace("/storage/v1/object/uploads-private/", "")));
  }
  if (url.pathname.startsWith("/storage/v1/object/sign/uploads-private/") && request.method() === "GET") {
    return route.fulfill({ status: 200, contentType: "image/png", body: PIXEL_PNG });
  }
  if (url.pathname === "/storage/v1/object/sign/uploads-private" && request.method() === "POST") {
    const paths = (request.postDataJSON() as { paths: string[] }).paths;
    return json(route, paths.map((p) => ({ path: p, signedURL: `/object/sign/uploads-private/${p}?token=e2e`, error: null })));
  }
  return json(route, { Key: "uploads-private/e2e" });
}

/** 管理者用 RPC（REQ-002）の代役。世界の状態を本物の RPC と同じように変える。戻り値が undefined なら管理者用ではない */
function administer(name: string, body: Record<string, unknown>, world: MockWorld): unknown {
  if (name === "register_background_photo") {
    world.backgroundPhotos = [...(world.backgroundPhotos ?? []),
      { id: `bg-new-${(world.backgroundPhotos?.length ?? 0) + 1}`, path: String(body.p_storage_path), description: String(body.p_description) }];
    return `bg-new-${world.backgroundPhotos.length}`;
  }
  if (name === "retire_background_photo") {
    world.backgroundPhotos = (world.backgroundPhotos ?? []).filter((p) => p.id !== body.p_id);
    return null;
  }
  if (name === "create_prompt_version") {
    const purpose = body.p_purpose as "PLAN" | "REVISE";
    const versions = world.promptVersions ?? [];
    const versionNo = Math.max(0, ...versions.filter((v) => v.purpose === purpose).map((v) => v.versionNo)) + 1;
    const id = `pv-${purpose}-${versionNo}`;
    world.promptVersions = [...versions, { id, purpose, versionNo, body: String(body.p_body) }];
    return id;
  }
  if (name === "activate_prompt_version") {
    const version = (world.promptVersions ?? []).find((v) => v.id === body.p_id);
    if (version) world.activePrompts = { ...world.activePrompts, [version.purpose]: version.id };
    return null;
  }
  if (name === "save_post_style_settings") {
    world.styleVersion = (world.styleSettings ? (world.styleVersion ?? 1) : 0) + 1;
    world.styleSettings = true;
    world.styleOverride = body;
    world.styleLogoPath = (body.p_logo_storage_path as string | null) ?? undefined;
    return world.styleVersion;
  }
  return undefined;
}

function tableRows(table: string, url: URL, world: MockWorld): unknown[] {
  const templateRows = templateTableRows(table, world);
  if (templateRows) return templateRows;
  if (table === "post_style_settings_current") return world.styleSettings ? [styleRow(world)] : [];
  if (table === "post_style_logos") return world.styleLogoPath ? [{ storage_path: world.styleLogoPath }] : [];
  if (table === "prompt_versions" || table === "active_prompt_versions") return promptRows(table, url, world);
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
  post_id: p.id, status: p.status, revision_id: `${p.id}-r1`, format: p.template ? "CAROUSEL" : "FEED_IMAGE",
  ...(p.template ? { media_source: "TEMPLATE" } : {}), caption: p.template?.caption ?? `${p.id} のキャプション`,
  pr_category: "NONE", genre_id: null, scheduled_at: p.scheduledAt?.toISOString() ?? null,
  ig_media_id: p.publishedAt ? "1790" : null, permalink: p.publishedAt ? "https://www.instagram.com/p/x/" : null,
  published_at: p.publishedAt?.toISOString() ?? null,
  last_failure_kind: p.failure?.kind ?? null, last_failure_message: p.failure?.message ?? null,
});

/** 投稿の型の設定の現在の版。保存（save_post_style_settings）のあとは、保存した内容を返す */
function styleRow(world: MockWorld) {
  const saved = world.styleOverride;
  const version = world.styleVersion ?? 1;
  if (!saved) {
    return {
      id: 1, tenant_id: "t1", version, band_text: "新島info", cover_targets: ["同志社大学", "同志社大生"],
      closing_message: "ご覧いただきありがとうございます", account_introduction: "@niijima_info\n学生生活を発信中",
      caption_footer: "──────\n新島info", fixed_hashtags: ["#新島info", "#同志社"],
    };
  }
  return {
    id: version, tenant_id: "t1", version, band_text: saved.p_band_text, cover_targets: saved.p_cover_targets,
    closing_message: saved.p_closing_message, account_introduction: saved.p_account_introduction,
    caption_footer: saved.p_caption_footer, fixed_hashtags: saved.p_fixed_hashtags,
  };
}

/** prompt_versions / active_prompt_versions（用途の絞り込みと並び順に対応） */
function promptRows(table: string, url: URL, world: MockWorld): unknown[] {
  const purposeFilter = url.searchParams.get("purpose");
  const versions = (world.promptVersions ?? [])
    .filter((v) => !purposeFilter || purposeFilter === `eq.${v.purpose}`)
    .sort((a, b) => b.versionNo - a.versionNo);
  if (table === "prompt_versions") return versions.map((v) => ({ id: v.id, purpose: v.purpose, version_no: v.versionNo, body: v.body }));
  return versions.filter((v) => world.activePrompts?.[v.purpose] === v.id).map((v) => ({ prompt_version_id: v.id }));
}

const connection = () => ({
  ig_username: "niijima_info", connected_at: minutesFromNow(-60 * 24).toISOString(),
  token_expires_at: minutesFromNow(60 * 24 * 50).toISOString(), last_refresh_failed_at: null,
});

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/**
 * テンプレートの投稿の版を読む表（revision_templates・post_slides・cover_slides・body_slides …）。テンプレートの投稿が無ければ undefined。
 * 絞り込み（revision_id・slide_id）は見ず、世界にある最初のテンプレートの投稿の内容を返す。スライドの位置は1始まり（表紙=1）
 */
function templateTableRows(table: string, world: MockWorld): unknown[] | undefined {
  const post = world.posts.find((p) => p.template);
  const t = post?.template;
  if (!post || !t) return undefined;
  const sid = (position: number) => `${post.id}-s${position}`;
  const bodyAt = (i: number) => ({ body: t.bodies[i], position: i + 2 });
  const bodies = t.bodies.map((_, i) => bodyAt(i));
  switch (table) {
    case "revision_templates": return [{ template_version: "niijima@1", style_settings_id: 1 }];
    case "post_style_settings": return [styleRow(world)];
    case "post_slides": return [
      { id: sid(1), position: 1, role: "COVER" },
      ...bodies.map(({ position }) => ({ id: sid(position), position, role: "BODY" })),
      { id: sid(t.bodies.length + 2), position: t.bodies.length + 2, role: "CLOSING" },
    ];
    case "revision_hashtags": return t.hashtags.map((hashtag, i) => ({ hashtag, position: i + 1 }));
    case "revision_generations": return t.generationId ? [{ generation_id: t.generationId }] : [];
    case "revision_generated_styles": return bodies.flatMap(({ body, position }) => (body.material?.style
      ? [{ position, generation_id: t.generationId ?? "g-1", candidate_position: 1, style: body.material.style }] : []));
    case "cover_slides": return [{ slide_id: sid(1), target: t.cover.target, keyword: t.cover.keyword, annotation: t.cover.annotation,
      closing_words: t.cover.closingWords, accent: t.cover.accent }];
    case "body_slides": return bodies.map(({ body, position }) => ({ slide_id: sid(position), heading: body.heading, description: body.description,
      picture_prompt: body.picturePrompt, needs_replacement: body.needsReplacement ?? false }));
    case "body_emphases": return bodies.flatMap(({ body, position }) => body.emphases.map((e, seq) => ({ slide_id: sid(position), seq, start_cp: e.start, length_cp: e.length })));
    case "body_materials": return bodies.flatMap(({ body, position }) => (body.material
      ? [{ slide_id: sid(position), storage_path: body.material.path, width: 1200, height: 900, byte_size: 150000 }] : []));
    case "cover_backgrounds": return t.cover.backgroundPhotoId ? [{ slide_id: sid(1), background_photo_id: t.cover.backgroundPhotoId }] : [];
    case "background_photos": return (world.backgroundPhotos ?? []).map((p) => ({ id: p.id, storage_path: p.path }));
    default: return undefined;
  }
}
