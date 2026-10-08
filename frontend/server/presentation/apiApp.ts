import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ConnectingForbiddenError, type ConnectingOutcome, type InstagramConnecting } from "../connection/application/instagramConnecting";
import type { DraftGenerating } from "../draft/application/draftGenerating";
import { DraftRefusal } from "../draft/application/draftPorts";
import type { ManualRelay } from "../draft/application/manualRelay";
import type { CandidateClearing } from "../image/application/candidateClearing";
import type { ImageGenerating } from "../image/application/imageGenerating";
import { ImageGenerationRefusal } from "../image/application/imageGenerationPorts";

// API関数（Cloudflare Pages Functions, Hono）。契約は 02_外部連携設計 5章・REQ-005 設計 4章。トークンや鍵はどのレスポンス・ログにも出さない
// ユースケースの組み立て（外部の実装）は入口（functions/api/[[route]].ts）から渡す

/** 失敗を記録する。例外の文言は infrastructure が状態コードだけにしているので、秘密は含まれない */
const logFailure = (where: string, e: unknown) =>
  console.error(`[api] ${where}: ${e instanceof Error ? `${e.name}: ${e.message}` : "unknown error"}`);

const REFUSAL_STATUS: Record<ImageGenerationRefusal["code"], ContentfulStatusCode> = {
  INVALID_PROMPT: 400, FORBIDDEN: 403, NOT_FOUND: 404, IMAGE_LIMIT_REACHED: 409,
  TRANSLATION_UNAVAILABLE: 503, GENERATION_FAILED: 502, GENERATION_TIMEOUT: 504,
};

// 下書き案の生成（REQ-002 設計 4章）。手動コピペの取り込みの INVALID_OUTPUT は 400、生成での INVALID_OUTPUT は 502
const DRAFT_REFUSAL: Record<DraftRefusal["code"], { status: ContentfulStatusCode; code: string }> = {
  INVALID_IDEA: { status: 400, code: "INVALID_IDEA" }, INVALID_REQUEST: { status: 400, code: "INVALID_REQUEST" },
  FORBIDDEN: { status: 403, code: "FORBIDDEN" }, NOT_FOUND: { status: 404, code: "NOT_FOUND" },
  STYLE_NOT_CONFIGURED: { status: 409, code: "STYLE_NOT_CONFIGURED" }, LLM_LIMIT_REACHED: { status: 409, code: "LLM_LIMIT_REACHED" },
  INVALID_OUTPUT: { status: 502, code: "INVALID_OUTPUT" }, INVALID_MANUAL_OUTPUT: { status: 400, code: "INVALID_OUTPUT" },
  LLM_UNAVAILABLE: { status: 503, code: "LLM_UNAVAILABLE" }, LLM_TIMEOUT: { status: 504, code: "LLM_TIMEOUT" },
};

const errorBody = (code: string, message: string, details: string[] = [], ideaId?: string) =>
  ({ error: { code, message, details, ...(ideaId ? { ideaId } : {}) } });

const objectOf = async (c: Context): Promise<Record<string, unknown>> => {
  const body: unknown = await c.req.json().catch(() => ({}));
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
};

export function createApiApp<Env extends object>(assembly: {
  connecting: (env: Env) => Promise<InstagramConnecting>;
  imageGenerating: (env: Env) => Promise<ImageGenerating>;
  candidateClearing: (env: Env) => Promise<CandidateClearing>;
  draftGenerating: (env: Env) => Promise<DraftGenerating>;
  manualRelay: (env: Env) => Promise<ManualRelay>;
}) {
  const app = new Hono<{ Bindings: Env }>().basePath("/api");
  const bearerOf = (c: Context) => c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  app.post("/instagram/connect", async (c) => {
    try {
      const authorizeUrl = await (await assembly.connecting(c.env)).start(bearerOf(c));
      return c.json({ authorizeUrl });
    } catch (e) {
      if (e instanceof ConnectingForbiddenError) return c.json(errorBody("FORBIDDEN", e.message), 403);
      throw e;
    }
  });

  app.get("/instagram/callback", async (c) => {
    const outcome: ConnectingOutcome = await (await assembly.connecting(c.env)).complete({
      code: c.req.query("code") ?? null, state: c.req.query("state") ?? null, error: c.req.query("error") ?? null,
    }).catch((e) => {
      logFailure("instagram/callback", e);
      return { ok: false, reason: "failed" };
    });
    return c.redirect(outcome.ok ? "/settings/?instagram=connected" : `/settings/?instagram=error&reason=${outcome.reason}`, 302);
  });

  app.post("/image-generations", async (c) => {
    const started = Date.now();
    const body = await c.req.json<{ style?: string; prompt?: string }>().catch(() => ({} as { style?: string; prompt?: string }));
    const result = await (await assembly.imageGenerating(c.env)).generate(bearerOf(c), { style: body.style ?? "", prompt: body.prompt ?? "" });
    console.log(`[api] image-generations: ${result.candidates.length} candidates in ${Date.now() - started} ms`);   // NFR-005-04 の所要時間
    return c.json(result, 201);
  });

  app.post("/image-generations/:id/clear", async (c) => {
    await (await assembly.candidateClearing(c.env)).clear(bearerOf(c), c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/drafts", async (c) => {
    const body = await objectOf(c);
    const result = await (await assembly.draftGenerating(c.env)).generate(bearerOf(c), { ideaText: typeof body.ideaText === "string" ? body.ideaText : "" });
    return c.json(result, 201);
  });

  // 固定の語（manual-prompt・manual）は、:generationId より先に登録する
  app.post("/drafts/manual-prompt", async (c) => c.json(await (await assembly.manualRelay(c.env)).prompt(bearerOf(c), await objectOf(c)), 201));

  app.post("/drafts/manual", async (c) => c.json(await (await assembly.manualRelay(c.env)).import(bearerOf(c), await objectOf(c)), 201));

  app.post("/drafts/:generationId/revise", async (c) => {
    const body = await objectOf(c);
    const result = await (await assembly.draftGenerating(c.env)).revise(bearerOf(c), c.req.param("generationId"),
      { instruction: typeof body.instruction === "string" ? body.instruction : "", current: body.current });
    return c.json(result, 201);
  });

  app.onError((e, c) => {
    if (e instanceof DraftRefusal) {
      const mapped = DRAFT_REFUSAL[e.code];
      return c.json(errorBody(mapped.code, e.message, e.details, e.ideaId), mapped.status);
    }
    if (e instanceof ImageGenerationRefusal) return c.json(errorBody(e.code, e.message, e.details), REFUSAL_STATUS[e.code]);
    logFailure(c.req.path, e);
    return c.json(errorBody("INTERNAL", "処理に失敗しました。時間を置いてお試しください"), 500);
  });
  return app;
}
