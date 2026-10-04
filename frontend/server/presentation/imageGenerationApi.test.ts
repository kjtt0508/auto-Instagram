import { describe, expect, it } from "vitest";
import { ImageGenerationQuota } from "../../src/domain/image/ImageGenerationQuota";
import { ImageGenerator } from "../../src/domain/image/ImageGenerator";
import { ImageGenerating } from "../image/application/imageGenerating";
import type { ImageGenerationRecords } from "../image/application/imageGenerationPorts";
import type { WorkersAiBinding } from "../image/infrastructure/workersAiCandidateClient";
import { apiAssembly, type ApiEnv } from "../shared/infrastructure/apiAssembly";
import { createApiApp } from "./apiApp";

// 画像生成の API（REQ-005 設計 1・4・6章）。Supabase・Gemini・Workers AI は偽物
const GEMINI_KEY = "gemini-secret-key";
const SERVICE_KEY = "service-role-secret";
const OTHER_TENANT_GENERATION = "0b9e7c1e-0000-4000-8000-0000000000aa";
const UNKNOWN_GENERATION = "0b9e7c1e-0000-4000-8000-0000000000bb";

type World = {
  role?: string; used?: number; llmAllowed?: boolean; imageAllowed?: boolean; gemini?: "ok" | "error";
  ai?: "ok" | "error" | "partial"; model?: string;
  uploadFails?: number; // 候補の保存を最初の何回か失敗させる
  recordFails?: boolean;
};

function fakes(world: World = {}) {
  const calls: { kind: string; detail: string; body?: unknown }[] = [];
  let used = world.used ?? 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.endsWith("/auth/v1/user")) return json({ id: "user-1" });
    if (url.includes("/rest/v1/member_current")) return json(world.role === "NONE" ? [] : [{ member_id: "m1", tenant_id: "t1", role: world.role ?? "EDITOR" }]);
    if (url.includes("image_generation_settings_current")) return json([{ provider: "CLOUDFLARE_WORKERS_AI", model: world.model ?? "@cf/flux", daily_limit: 20, warn_ratio: 0.8 }]);
    if (url.includes("tenant_settings_current")) return json([{ llm_model: "gemini-test", llm_daily_limit: 200 }]);
    if (url.includes("rpc/image_generation_usage_of")) return json([{ used }]);
    if (url.includes("rpc/try_consume_llm")) { calls.push({ kind: "llm", detail: "" }); return json([{ allowed: world.llmAllowed ?? true, used: 1 }]); }
    if (url.includes("rpc/try_consume_image_generation")) {
      calls.push({ kind: "reserve", detail: "" });
      if (world.imageAllowed === false) return json([{ allowed: false, used }]);
      used += 1;
      return json([{ allowed: true, used }]);
    }
    if (url.includes("rpc/record_image_generation")) {
      calls.push({ kind: "record", detail: "", body });
      return world.recordFails ? json({ message: "db down" }, 500) : new Response(null, { status: 204 });
    }
    if (url.includes("/storage/v1/object/uploads-private/") && (world.uploadFails ?? 0) > 0) {
      world.uploadFails! -= 1;
      return json({ message: "storage down" }, 500);
    }
    if (url.includes("/storage/v1/object/sign/")) return json({ signedURL: `/object/sign/${url.split("/object/sign/")[1]}?token=t` });
    if (url.includes("/storage/v1/object/uploads-private/")) { calls.push({ kind: "upload", detail: url.split("uploads-private/")[1] }); return json({ Key: "k" }); }
    if (url.endsWith("/storage/v1/object/uploads-private") && init?.method === "DELETE") { calls.push({ kind: "delete", detail: "", body }); return json([]); }
    if (url.includes("/rest/v1/image_generations?select=tenant_id")) {
      return json(url.includes(UNKNOWN_GENERATION) ? [] : [{ tenant_id: url.includes(OTHER_TENANT_GENERATION) ? "t2" : "t1" }]);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      calls.push({ kind: "gemini", detail: url, body });
      return world.gemini === "error" ? json({ error: {} }, 500) : json({ candidates: [{ content: { parts: [{ text: "cherry blossom path, watercolor" }] } }] });
    }
    return json({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  let aiCalls = 0;
  const ai: WorkersAiBinding = {
    run: async (model, input) => {
      aiCalls += 1;
      calls.push({ kind: "ai", detail: `${model}|${input.prompt}` });
      if (world.ai === "error") throw new Error("upstream 500");
      if (world.ai === "partial" && aiCalls % 2 === 0) throw new Error("upstream 500");
      return { image: btoa("jpeg-bytes") };
    },
  };
  const env = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, TOKEN_ENC_KEY_V1: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    IG_APP_ID: "", IG_APP_SECRET: "", IG_REDIRECT_URI: "", IG_API_VERSION: "", GEMINI_API_KEY: GEMINI_KEY, AI: ai } satisfies ApiEnv;
  let id = 0;
  const app = createApiApp(apiAssembly(http, () => `gen-${++id}`));
  const post = (path: string, body?: unknown) => app.request(path, {
    method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }, env);
  return { post, calls, kinds: () => calls.map((c) => c.kind) };
}

const generate = (f: ReturnType<typeof fakes>, prompt = "桜並木のやわらかい水彩風の背景", style = "ILLUSTRATION") =>
  f.post("/api/image-generations", { style, prompt });

describe("POST /api/image-generations", () => {
  it("AC-005-01 指示を英訳してから候補を4枚作り、期限付き URL と回数を返し、成功として記録する", async () => {
    const f = fakes();
    const response = await generate(f);
    const body = await response.json() as { generationId: string; candidates: { position: number; url: string }[]; usage: unknown };
    expect(response.status).toBe(201);
    expect(f.kinds()).toEqual(["llm", "gemini", "reserve", "ai", "ai", "ai", "ai", "upload", "upload", "upload", "upload", "record"]);
    expect(body.candidates.map((c) => c.position)).toEqual([1, 2, 3, 4]);
    expect(body.candidates[0].url).toContain("/storage/v1/object/sign/uploads-private/t1/candidates/gen-1/1.jpg");
    expect(body.usage).toEqual({ used: 1, dailyLimit: 20, warnRatio: 0.8 });
    expect(f.calls.find((c) => c.kind === "ai")!.detail).toBe("@cf/flux|cherry blossom path, watercolor");
    expect(f.calls.find((c) => c.kind === "record")!.body).toMatchObject({
      p_id: "gen-1", p_style: "ILLUSTRATION", p_prompt_ja: "桜並木のやわらかい水彩風の背景", p_prompt_en: "cherry blossom path, watercolor",
      p_outcome: "SUCCEEDED", p_candidate_count: 4, p_model: "@cf/flux" });
  });

  it("NFR-005-01 鍵（Gemini・service role）はレスポンスに出ず、Gemini のキーはヘッダーで送る", async () => {
    const f = fakes();
    const text = await (await generate(f)).text();
    expect(text).not.toContain(GEMINI_KEY);
    expect(text).not.toContain(SERVICE_KEY);
    expect(f.calls.find((c) => c.kind === "gemini")!.detail).not.toContain(GEMINI_KEY);
  });

  it.each([["0文字", ""], ["501文字", "あ".repeat(501)], ["メール", "taro@example.com"], ["電話番号", "090-1234-5678"]])(
    "AC-005-02 AC-005-03 指示が不正（%s）なら 400 で、Gemini も提供元も呼ばず回数も記録も増えない", async (_, prompt) => {
      const f = fakes();
      const response = await generate(f, prompt);
      expect(response.status).toBe(400);
      expect(f.kinds()).toEqual([]);
    });

  it("AC-005-06 上限に達していたら 409 で、英訳もしない（LLM利用回数を使わない）", async () => {
    const f = fakes({ used: 20 });
    const response = await generate(f);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe("今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください");
    expect(f.kinds()).toEqual([]);
  });

  it("AC-005-06 事前確認の後に他の人が使い切ったら 409（LLM利用回数は1回使う）", async () => {
    const f = fakes({ used: 19, imageAllowed: false });
    expect((await generate(f)).status).toBe(409);
    expect(f.kinds()).toEqual(["llm", "gemini", "reserve"]);
  });

  it("AC-005-14 LLM上限なら 503 で、Gemini も提供元も呼ばず記録しない", async () => {
    const f = fakes({ llmAllowed: false });
    const response = await generate(f);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe("いまは画像を作れません。写真を撮る・選ぶで続けてください");
    expect(f.kinds()).toEqual(["llm"]);
  });

  it("AC-005-14 Gemini が失敗したら 503 で、提供元を呼ばず記録しない（LLM利用回数だけ使う）", async () => {
    const f = fakes({ gemini: "error" });
    expect((await generate(f)).status).toBe(503);
    expect(f.kinds()).toEqual(["llm", "gemini"]);
  });

  it("AC-005-07 提供元が失敗したら 502 で、失敗として記録する（回数は使ったまま）", async () => {
    const f = fakes({ ai: "error" });
    const response = await generate(f);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe("画像を生成できませんでした");
    expect(f.calls.find((c) => c.kind === "record")!.body).toMatchObject({ p_outcome: "FAILED", p_candidate_count: 0 });
  });

  it("AC-005-01 一部の候補だけ作れたら、作れた分を位置 1 から詰めて返す", async () => {
    const f = fakes({ ai: "partial" });
    const body = await (await generate(f)).json() as { candidates: { position: number; url: string }[] };
    expect(body.candidates.map((c) => c.position)).toEqual([1, 2]);
    expect(f.calls.filter((c) => c.kind === "upload").map((c) => c.detail)).toEqual(["t1/candidates/gen-1/1.jpg", "t1/candidates/gen-1/2.jpg"]);
  });

  it("AC-005-01 候補の保存が1枚失敗しても、保存できた分を位置 1 から詰めて記録する", async () => {
    const f = fakes({ uploadFails: 1 });
    const body = await (await generate(f)).json() as { candidates: { position: number }[] };
    expect(body.candidates.map((c) => c.position)).toEqual([1, 2, 3]);
    expect(f.calls.find((c) => c.kind === "record")!.body).toMatchObject({ p_candidate_count: 3 });
  });

  it("BR-005-11 記録に失敗したら、保存した候補を消してから失敗にする（記録の無い候補を残さない）", async () => {
    const f = fakes({ recordFails: true });
    expect((await generate(f)).status).toBe(500);
    const deleted = f.calls.find((c) => c.kind === "delete")!.body as { prefixes: string[] };
    expect(deleted.prefixes).toEqual([1, 2, 3, 4].map((p) => `t1/candidates/gen-1/${p}.jpg`));
  });

  it("AC-005-15 編集者も管理者も画像生成できる。メンバーでなければ 403", async () => {
    expect((await generate(fakes({ role: "EDITOR" }))).status).toBe(201);
    expect((await generate(fakes({ role: "ADMIN" }))).status).toBe(201);
    expect((await generate(fakes({ role: "NONE" }))).status).toBe(403);
  });

  it("AC-005-16 団体設定のモデル名を変えると、コード変更なしにそのモデルで呼び、記録に残る", async () => {
    const f = fakes({ model: "@cf/black-forest-labs/flux-2-klein" });
    await generate(f);
    expect(f.calls.find((c) => c.kind === "ai")!.detail.startsWith("@cf/black-forest-labs/flux-2-klein|")).toBe(true);
    expect(f.calls.find((c) => c.kind === "record")!.body).toMatchObject({ p_model: "@cf/black-forest-labs/flux-2-klein" });
  });
});

describe("POST /api/image-generations/{id}/clear", () => {
  const OWN = "0b9e7c1e-0000-4000-8000-000000000009";

  it("AC-005-12 採用の操作を終えたら、その画像生成の候補の画像を消す（何度呼んでもよい）", async () => {
    const f = fakes();
    expect((await f.post(`/api/image-generations/${OWN}/clear`)).status).toBe(204);
    expect((await f.post(`/api/image-generations/${OWN}/clear`)).status).toBe(204);
    expect(f.calls.find((c) => c.kind === "delete")!.body).toEqual({ prefixes: [1, 2, 3, 4].map((p) => `t1/candidates/${OWN}/${p}.jpg`) });
  });

  it("ほかの団体の画像生成は 403、無ければ 404、画像生成IDの形でなければ問い合わせずに 404", async () => {
    const f = fakes();
    expect((await f.post(`/api/image-generations/${OTHER_TENANT_GENERATION}/clear`)).status).toBe(403);
    expect((await f.post(`/api/image-generations/${UNKNOWN_GENERATION}/clear`)).status).toBe(404);
    expect((await f.post("/api/image-generations/not-a-uuid/clear")).status).toBe(404);
  });
});

describe("時間切れ（全体60秒）", () => {
  it("AC-005-07 提供元が時間内に1枚も返さなければ 504 として失敗を記録する", async () => {
    const recorded: string[] = [];
    const records: ImageGenerationRecords = {
      memberOf: async () => ({ memberId: "m1", tenantId: "t1" }),
      settingsOf: async () => ({ generator: ImageGenerator.of("CLOUDFLARE_WORKERS_AI", "m"), quota: ImageGenerationQuota.of(20, 0.8),
        llmModel: "g", llmDailyLimit: 200 }),
      usedToday: async () => 0, tryConsumeLlm: async () => true, tryConsumeImageGeneration: async () => ({ allowed: true, used: 1 }),
      saveCandidate: async () => "url", record: async (_m, g) => { recorded.push(g.outcome()); },
      tenantOfGeneration: async () => "t1", clearCandidates: async () => undefined,
    };
    let clock = 0;
    const generating = new ImageGenerating({
      records, translator: { toEnglish: async () => "cherry blossoms" },
      images: { generate: () => new Promise<Uint8Array>(() => undefined) },   // 返ってこない提供元
      newId: () => "gen-t", now: () => (clock += 60_000),                     // 英訳の時点で全体の60秒を使い切っている
    });
    await expect(generating.generate("jwt", { style: "ILLUSTRATION", prompt: "桜" })).rejects.toMatchObject({ code: "GENERATION_TIMEOUT" });
    expect(recorded).toEqual(["FAILED"]);
  });
});
