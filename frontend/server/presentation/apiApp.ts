import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ConnectingForbiddenError, type ConnectingOutcome, type InstagramConnecting } from "../connection/application/instagramConnecting";
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

const errorBody = (code: string, message: string, details: string[] = []) => ({ error: { code, message, details } });

export function createApiApp<Env extends object>(assembly: {
  connecting: (env: Env) => Promise<InstagramConnecting>;
  imageGenerating: (env: Env) => Promise<ImageGenerating>;
  candidateClearing: (env: Env) => Promise<CandidateClearing>;
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

  app.onError((e, c) => {
    if (e instanceof ImageGenerationRefusal) return c.json(errorBody(e.code, e.message, e.details), REFUSAL_STATUS[e.code]);
    logFailure(c.req.path, e);
    return c.json(errorBody("INTERNAL", "処理に失敗しました。時間を置いてお試しください"), 500);
  });
  return app;
}
