import { Hono } from "hono";
import { ConnectingForbiddenError, type ConnectingOutcome, type InstagramConnecting } from "../connection/application/instagramConnecting";

// API関数（Cloudflare Pages Functions, Hono）。契約は 02_外部連携設計 5章。トークンはどのレスポンス・ログにも出さない
// ユースケースの組み立て（外部の実装）は入口（functions/api/[[route]].ts）から渡す

/** 失敗を記録する。例外の文言は infrastructure が状態コードだけにしているので、トークンは含まれない */
const logFailure = (where: string, e: unknown) =>
  console.error(`[api] ${where}: ${e instanceof Error ? `${e.name}: ${e.message}` : "unknown error"}`);

export function createApiApp<Env extends object>(connectingFor: (env: Env) => Promise<InstagramConnecting>) {
  const app = new Hono<{ Bindings: Env }>().basePath("/api");

  app.post("/instagram/connect", async (c) => {
    const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    try {
      const authorizeUrl = await (await connectingFor(c.env)).start(bearer);
      return c.json({ authorizeUrl });
    } catch (e) {
      if (e instanceof ConnectingForbiddenError) return c.json({ error: { code: "FORBIDDEN", message: e.message, details: [] } }, 403);
      throw e;
    }
  });

  app.get("/instagram/callback", async (c) => {
    const outcome: ConnectingOutcome = await (await connectingFor(c.env)).complete({
      code: c.req.query("code") ?? null, state: c.req.query("state") ?? null, error: c.req.query("error") ?? null,
    }).catch((e) => {
      logFailure("instagram/callback", e);
      return { ok: false, reason: "failed" };
    });
    return c.redirect(outcome.ok ? "/settings/?instagram=connected" : `/settings/?instagram=error&reason=${outcome.reason}`, 302);
  });

  app.onError((e, c) => {
    logFailure(c.req.path, e);
    return c.json({ error: { code: "INTERNAL", message: "処理に失敗しました。時間を置いてお試しください", details: [] } }, 500);
  });
  return app;
}
