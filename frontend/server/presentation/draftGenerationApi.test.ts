import { describe, expect, it, vi } from "vitest";
import { DraftGenerating } from "../draft/application/draftGenerating";
import { GeminiDraftClient } from "../draft/infrastructure/geminiDraftClient";
import { SupabaseDraftRecords } from "../draft/infrastructure/supabaseDraftRecords";
import { apiAssembly, type ApiEnv } from "../shared/infrastructure/apiAssembly";
import { SupabaseService } from "../shared/infrastructure/supabaseService";
import { createApiApp } from "./apiApp";

// 下書き案の生成・修正指示の API（REQ-002 設計 1・4・7・8章）。Supabase・Gemini は偽物
const GEMINI_KEY = "gemini-secret-key";
const SERVICE_KEY = "service-role-secret";
const PARENT = "0b9e7c1e-0000-4000-8000-0000000000a1";
const OTHER_TENANT_PARENT = "0b9e7c1e-0000-4000-8000-0000000000a2";
const UNKNOWN = "0b9e7c1e-0000-4000-8000-0000000000a3";
const PARENT_IDEA = "0b9e7c1e-0000-4000-8000-0000000000b1";
const OTHER_TENANT_IDEA = "0b9e7c1e-0000-4000-8000-0000000000b2";
export const PLAN_VERSION = "0b9e7c1e-0000-4000-8000-0000000000c1";
export const REVISE_VERSION = "0b9e7c1e-0000-4000-8000-0000000000c2";
const OTHER_TENANT_VERSION = "0b9e7c1e-0000-4000-8000-0000000000c3";
export const IDEA_TEXT = "・学割が使える\n・京都駅の近く";

const PLAN_BODY = "ネタ:{{ideaText}}\n今日:{{today}}\n対象:{{coverTargets}}\n色:{{accentColors}}\n写真:\n{{backgroundPhotos}}\n上限:{{limits}}";
const REVISE_BODY = "現在:{{currentDraft}}\n指示:{{instruction}}\n枚数:{{bodySlideCount}}\n対象:{{coverTargets}}";

export type GeminiStep = { text: string } | { status: number } | "timeout";

export type World = {
  role?: string; used?: number; limit?: number; model?: string; styleMissing?: boolean; photos?: { id: string; description: string }[];
  gemini?: GeminiStep[];   // 呼ばれた順の応答。足りなければ最後のものを繰り返す
  recordFails?: boolean; now?: () => number;
};

export const slide = (n: number, overrides: Record<string, unknown> = {}) => ({
  heading: `見出し${n}`, description: `説明文${n}です。学割が使えます。`, emphases: ["学割"],
  picturePrompt: "明るい雰囲気のカフェの背景", needsReplacement: false, ...overrides,
});

export const draft = (overrides: Record<string, unknown> = {}) => ({
  cover: { target: "同志社大学", keyword: "期末試験", annotation: "＼ 日程発表 ／", closingWords: "まとめたよ", accent: "PURPLE" },
  backgroundPhotoId: "bg1", slides: [slide(1), slide(2), slide(3)], caption: "期末試験の日程をまとめました😀\n\n早めに確認しておきましょう。",
  additionalHashtags: ["#学割", "#京都"], prCategory: "NONE", sourceUrls: [], ...overrides,
});

const okStep = (value: unknown = draft()): GeminiStep => ({ text: JSON.stringify(value) });

export type Call = { kind: string; detail: string; body?: any; headers?: Record<string, string> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export function fakes(world: World = {}) {
  const calls: Call[] = [];
  let used = world.used ?? 0;
  let geminiCount = 0;
  let nextId = 0;
  const ideas = new Map<string, { tenant_id: string; body: string }>([
    [PARENT_IDEA, { tenant_id: "t1", body: IDEA_TEXT }], [OTHER_TENANT_IDEA, { tenant_id: "t2", body: "他団体" }]]);
  const generations = new Map<string, { tenant_id: string; idea_id: string }>([
    [PARENT, { tenant_id: "t1", idea_id: PARENT_IDEA }], [OTHER_TENANT_PARENT, { tenant_id: "t2", idea_id: OTHER_TENANT_IDEA }]]);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const idIn = (url: string) => decodeURIComponent(url.split("id=eq.")[1] ?? "");
  const version = (id: string, purpose: string, tenant: string) => ({ id, tenant_id: tenant, purpose, version_no: 1, body: purpose === "PLAN" ? PLAN_BODY : REVISE_BODY });
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.endsWith("/auth/v1/user")) return json({ id: "user-1" });
    if (url.includes("/rest/v1/member_current")) return json(world.role === "NONE" ? [] : [{ member_id: "m1", tenant_id: "t1", role: world.role ?? "EDITOR" }]);
    if (url.includes("post_style_settings_current")) {
      return json(world.styleMissing ? [] : [{ tenant_id: "t1", version: 1, band_text: "帯", cover_targets: ["同志社大学", "同志社大生"], closing_message: "締め",
        account_introduction: "@test", caption_footer: "――\nテスト運営", fixed_hashtags: ["#同志社大学", "#同志社"] }]);
    }
    if (url.includes("tenant_settings_current")) {
      return json([{ llm_model: world.model ?? "gemini-test", llm_daily_limit: world.limit ?? 100, llm_warn_ratio: 0.8, pr_label: "【PR】\n" }]);
    }
    if (url.includes("usable_background_photos")) return json(world.photos ?? [{ id: "bg1", description: "正門" }, { id: "bg2", description: "図書館" }]);
    if (url.includes("active_prompt_versions")) {
      const purpose = url.includes("purpose=eq.REVISE") ? "REVISE" : "PLAN";
      return json([{ prompt_version_id: purpose === "PLAN" ? PLAN_VERSION : REVISE_VERSION, version_no: 1, body: purpose === "PLAN" ? PLAN_BODY : REVISE_BODY }]);
    }
    if (url.includes("/rest/v1/prompt_versions?")) {
      const id = idIn(url);
      return json(id === PLAN_VERSION ? [version(id, "PLAN", "t1")] : id === REVISE_VERSION ? [version(id, "REVISE", "t1")]
        : id === OTHER_TENANT_VERSION ? [version(id, "PLAN", "t2")] : []);
    }
    if (url.includes("/rest/v1/ideas?")) { const idea = ideas.get(idIn(url)); return json(idea ? [{ id: idIn(url), ...idea }] : []); }
    if (url.includes("/rest/v1/generations?")) { const g = generations.get(idIn(url)); return json(g ? [{ id: idIn(url), ...g }] : []); }
    if (url.includes("rpc/record_idea")) { calls.push({ kind: "idea", detail: "", body }); ideas.set(body.p_id, { tenant_id: body.p_tenant, body: body.p_body }); return new Response(null, { status: 204 }); }
    if (url.includes("rpc/try_consume_llm")) {
      calls.push({ kind: "llm", detail: "", body });
      if (used >= (world.limit ?? 100)) return json([{ allowed: false, used }]);
      used += 1;
      return json([{ allowed: true, used }]);
    }
    if (url.includes("rpc/record_generation")) {
      calls.push({ kind: "generation", detail: "", body });
      if (world.recordFails) return json({ message: "db down" }, 500);
      generations.set(body.p_id, { tenant_id: body.p_tenant, idea_id: body.p_idea });
      return new Response(null, { status: 204 });
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      calls.push({ kind: "gemini", detail: url, body, headers: init?.headers as Record<string, string> });
      const steps = world.gemini ?? [okStep()];
      const step = steps[Math.min(geminiCount, steps.length - 1)];
      geminiCount += 1;
      if (step === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
      if ("status" in step) return json({ error: { message: `upstream ${GEMINI_KEY}` } }, step.status);
      return json({ candidates: [{ content: { parts: [{ text: step.text }] } }] });
    }
    return json({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  const env = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, TOKEN_ENC_KEY_V1: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    IG_APP_ID: "", IG_APP_SECRET: "", IG_REDIRECT_URI: "", IG_API_VERSION: "", GEMINI_API_KEY: GEMINI_KEY, AI: { run: async () => ({ image: "" }) } } satisfies ApiEnv;
  const newId = () => `0b9e7c1e-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
  const base = apiAssembly(http, newId);
  const clock = world.now;
  const assembly = clock ? { ...base, draftGenerating: async () => new DraftGenerating({
    records: new SupabaseDraftRecords(new SupabaseService({ url: env.SUPABASE_URL, serviceRoleKey: SERVICE_KEY }, http)),
    model: new GeminiDraftClient(GEMINI_KEY, http), newId, now: clock }) } : base;
  const app = createApiApp(assembly);
  const post = (path: string, body?: unknown) => app.request(path, {
    method: "POST", headers: { Authorization: "Bearer jwt", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const only = (kind: string) => calls.filter((c) => c.kind === kind);
  return { post, calls, kinds: () => calls.map((c) => c.kind), only, recorded: () => only("generation")[0]?.body };
}

type Fakes = ReturnType<typeof fakes>;
const generate = (f: Fakes, ideaText = IDEA_TEXT) => f.post("/api/drafts", { ideaText });
const errorOf = async (response: Response) =>
  (await response.json() as { error: { code: string; message: string; details: string[]; ideaId?: string } }).error;

describe("POST /api/drafts", () => {
  it("AC-002-03 スキーマどおりの出力から、下書き案・ネタに無い情報・回数を返し、ネタ・回数・Gemini・生成の順に記録する", async () => {
    const f = fakes();
    const response = await generate(f);
    const body = await response.json() as { generationId: string; ideaId: string; proposal: ReturnType<typeof draft>; unsupportedFacts: unknown[]; usage: unknown };
    expect(response.status).toBe(201);
    expect(f.kinds()).toEqual(["idea", "llm", "gemini", "generation"]);
    expect(body.proposal.slides.map((s) => s.heading)).toEqual(["見出し1", "見出し2", "見出し3"]);
    expect(body.proposal).toMatchObject({ cover: { keyword: "期末試験", accent: "PURPLE" }, backgroundPhotoId: "bg1", prCategory: "NONE", additionalHashtags: ["#学割", "#京都"] });
    expect(body.unsupportedFacts).toEqual([]);
    expect(body.usage).toEqual({ used: 1, dailyLimit: 100, warnRatio: 0.8, warn: false });
    expect(f.recorded()).toMatchObject({ p_id: body.generationId, p_idea: body.ideaId, p_purpose: "PLAN", p_route: "API", p_outcome: "SUCCEEDED",
      p_prompt_version: "0b9e7c1e-0000-4000-8000-0000000000c1", p_parent: null, p_instruction: null });
    expect(f.recorded().p_attempts).toEqual([{ model: "gemini-test", rawOutput: JSON.stringify(draft()), violations: [] }]);
    expect(f.recorded().p_result).toEqual(body.proposal);
    expect(f.only("idea")[0].body).toMatchObject({ p_id: body.ideaId, p_tenant: "t1", p_member: "m1", p_body: IDEA_TEXT });
  });

  it("AC-002-03 Gemini へは JSON 出力とスキーマ（中のスライド 1〜8枚）を指定し、ネタ・背景写真の候補・上限をプロンプトに差し込む", async () => {
    const f = fakes();
    await generate(f);
    const request = f.only("gemini")[0].body;
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.responseSchema.properties.slides).toMatchObject({ minItems: 1, maxItems: 8 });
    const prompt: string = request.contents[0].parts[0].text;
    expect(prompt).toContain(`ネタ:${IDEA_TEXT}`);
    expect(prompt).toMatch(/今日:\d{4}-\d{2}-\d{2}/u);
    expect(prompt).toContain("対象:同志社大学、同志社大生");
    expect(prompt).toContain("bg1: 正門\nbg2: 図書館");
    expect(prompt).toContain("キーワード12文字");
    expect(prompt).not.toContain("{{");
  });

  it("AC-002-09 Gemini に渡す本文と記録する入力のどちらにも、入稿者連絡先の欄が無い", async () => {
    const f = fakes();
    await generate(f);
    const sent = JSON.stringify(f.only("gemini")[0].body);
    const input = f.recorded().p_input as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(["accentColors", "backgroundPhotos", "coverTargets", "ideaText", "today"]);
    for (const text of [sent, JSON.stringify(input)]) {
      for (const forbidden of ["contact", "Contact", "email", "submitter", "担当者", "連絡先"]) expect(text).not.toContain(forbidden);
    }
  });

  it("NFR-002-02 Gemini の鍵はヘッダーで送り、成功・失敗のどの応答にも出ない（Gemini のエラー本文に鍵があっても）", async () => {
    const ok = fakes();
    const okText = await (await generate(ok)).text();
    expect(ok.only("gemini")[0].headers).toMatchObject({ "x-goog-api-key": GEMINI_KEY });
    expect(ok.only("gemini")[0].detail).not.toContain(GEMINI_KEY);
    const failing = fakes({ gemini: [{ status: 500 }] });
    const failText = await (await generate(failing)).text();
    for (const text of [okText, failText]) {
      expect(text).not.toContain(GEMINI_KEY);
      expect(text).not.toContain(SERVICE_KEY);
    }
  });

  it("AC-002-10 団体設定のモデル名を変えると、そのモデルで呼び、利用回数・生成の記録もそのモデルになる", async () => {
    const f = fakes({ model: "gemini-next-flash" });
    await generate(f);
    expect(f.only("gemini")[0].detail).toContain("/models/gemini-next-flash:generateContent");
    expect(f.only("llm")[0].body).toMatchObject({ p_model: "gemini-next-flash" });
    expect(f.recorded().p_attempts[0].model).toBe("gemini-next-flash");
  });

  it("AC-002-13 ネタに無い日付は注意として返し、ネタにある日付・金額・URL は返さない", async () => {
    const unsupported = fakes({ gemini: [okStep(draft({ slides: [slide(1, { description: "11/3 から使えます。", emphases: [] })] }))] });
    const body = await (await generate(unsupported, "・学割が使える")).json() as { unsupportedFacts: { location: string; fact: string }[] };
    expect(body.unsupportedFacts).toEqual([{ location: "slides[0].description", fact: "11/3" }]);
    const supported = fakes({ gemini: [okStep(draft({ slides: [slide(1, { description: "11/3 から使えます。", emphases: [] })] }))] });
    const known = await (await generate(supported, "・11月3日から学割が使える")).json() as { unsupportedFacts: unknown[] };
    expect(known.unsupportedFacts).toEqual([]);
  });

  it("AC-002-04 違反の出力を直して返したら、違反を添えて作り直し、成功する（回数2回・試行2行）", async () => {
    const f = fakes({ gemini: [okStep(draft({ cover: { ...draft().cover, keyword: "あ".repeat(13) } })), okStep()] });
    const response = await generate(f);
    expect(response.status).toBe(201);
    expect(f.kinds()).toEqual(["idea", "llm", "gemini", "llm", "gemini", "generation"]);
    expect(f.only("gemini")[1].body.contents[0].parts[0].text).toContain("- キーワードは1〜12文字にしてください（13文字）");
    expect(f.recorded().p_outcome).toBe("SUCCEEDED");
    expect(f.recorded().p_attempts.map((a: { violations: string[] }) => a.violations)).toEqual([["キーワードは1〜12文字にしてください（13文字）"], []]);
    expect(((await response.json()) as { usage: { used: number } }).usage.used).toBe(2);
  });

  it("AC-002-04 違反が2回続くと 502 INVALID_OUTPUT（ideaId・違反つき）で、利用回数は2回、試行は2行、生成は失敗として記録する", async () => {
    const bad = okStep(draft({ cover: { ...draft().cover, keyword: "あ".repeat(13) } }));
    const f = fakes({ gemini: [bad] });
    const response = await generate(f);
    const error = await errorOf(response);
    expect(response.status).toBe(502);
    expect(error).toMatchObject({ code: "INVALID_OUTPUT", details: ["キーワードは1〜12文字にしてください（13文字）"] });
    expect(error.ideaId).toBe(f.only("idea")[0].body.p_id);
    expect(f.kinds()).toEqual(["idea", "llm", "gemini", "llm", "gemini", "generation"]);
    expect(f.recorded()).toMatchObject({ p_outcome: "INVALID_OUTPUT", p_result: null });
    expect(f.recorded().p_attempts).toHaveLength(2);
  });

  it("AC-002-04 JSON でない出力・スキーマに合わない出力も違反として扱い、生の出力を記録する", async () => {
    const f = fakes({ gemini: [{ text: "申し訳ありません、作れません" }] });
    const error = await errorOf(await generate(f));
    expect(error.code).toBe("INVALID_OUTPUT");
    expect(error.details[0]).toContain("JSON として読めません");
    expect(f.recorded().p_attempts[0].rawOutput).toBe("申し訳ありません、作れません");
  });

  it("AC-002-04 残り時間が20秒未満なら作り直さない（1回の呼び出しで 502）", async () => {
    let clock = 0;
    const slow = fakes({ gemini: [okStep(draft({ slides: [] }))], now: () => (clock += 25_000) });   // now() を呼ぶたびに25秒進む
    const response = await generate(slow);
    expect(response.status).toBe(502);
    expect(slow.only("gemini")).toHaveLength(1);
    expect(slow.only("llm")).toHaveLength(1);
    expect(slow.recorded().p_attempts).toHaveLength(1);
  });

  it.each([[79, false], [80, true], [99, true]])(
    "AC-002-06 上限100・割合0.8で %i 回使用済みなら生成でき、警告は %s", async (used, warn) => {
      const f = fakes({ used });
      const response = await generate(f);
      expect(response.status).toBe(201);
      expect(((await response.json()) as { usage: unknown }).usage).toEqual({ used: used + 1, dailyLimit: 100, warnRatio: 0.8, warn });
    });

  it("AC-002-06 100回使用済みなら Gemini を呼ばず 409 LLM_LIMIT_REACHED（ideaId つき）で、QUOTA_EXCEEDED・試行0行を記録する", async () => {
    const f = fakes({ used: 100 });
    const response = await generate(f);
    const error = await errorOf(response);
    expect(response.status).toBe(409);
    expect(error.code).toBe("LLM_LIMIT_REACHED");
    expect(error.ideaId).toBe(f.only("idea")[0].body.p_id);
    expect(f.kinds()).toEqual(["idea", "llm", "generation"]);
    expect(f.recorded()).toMatchObject({ p_outcome: "QUOTA_EXCEEDED", p_attempts: [], p_result: null });
  });

  it("AC-002-06 違反の後の2回目の確保で上限に当たったら、2回目を呼ばず 409（QUOTA_EXCEEDED・試行1行）", async () => {
    const f = fakes({ used: 99, gemini: [okStep(draft({ slides: [] }))] });
    const response = await generate(f);
    expect(response.status).toBe(409);
    expect(f.kinds()).toEqual(["idea", "llm", "gemini", "llm", "generation"]);
    expect(f.recorded()).toMatchObject({ p_outcome: "QUOTA_EXCEEDED" });
    expect(f.recorded().p_attempts).toHaveLength(1);
  });

  it("Gemini が 429・5xx なら 503 LLM_UNAVAILABLE（ideaId つき）で、確保した回数は戻さず LLM_ERROR を記録する", async () => {
    const f = fakes({ gemini: [{ status: 429 }] });
    const response = await generate(f);
    const error = await errorOf(response);
    expect(response.status).toBe(503);
    expect(error.code).toBe("LLM_UNAVAILABLE");
    expect(error.ideaId).toBeTruthy();
    expect(f.kinds()).toEqual(["idea", "llm", "gemini", "generation"]);
    expect(f.recorded()).toMatchObject({ p_outcome: "LLM_ERROR", p_attempts: [{ model: "gemini-test", rawOutput: "", violations: [] }] });
  });

  it("60秒を超えたら 504（ideaId つき）で、TIMEOUT を記録する", async () => {
    const f = fakes({ gemini: ["timeout"] });
    const response = await generate(f);
    const error = await errorOf(response);
    expect(response.status).toBe(504);
    expect(error.ideaId).toBeTruthy();
    expect(f.recorded()).toMatchObject({ p_outcome: "TIMEOUT" });
  });

  it("Gemini の呼び出しには、依頼全体の残り時間（最大60秒）の打ち切りを付ける", async () => {
    let clock = 0;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const f = fakes({ gemini: [okStep(draft({ slides: [] })), okStep()], now: () => { const t = clock; clock += 10_000; return t; } });   // 呼ぶたびに10秒進む
      await generate(f);
      // now() の呼び出し: 開始 0／1回目の呼び出し前 10s／作り直しの判定 20s／2回目の呼び出し前 30s
      expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([50_000, 30_000]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("投稿の型の設定が無いと 409 STYLE_NOT_CONFIGURED で、ネタも記録せず Gemini も呼ばない", async () => {
    const f = fakes({ styleMissing: true });
    const response = await generate(f);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("STYLE_NOT_CONFIGURED");
    expect(f.kinds()).toEqual([]);
  });

  it.each([["空", ""], ["空白だけ", "   "], ["2001文字", "あ".repeat(2001)]])("ネタが不正（%s）なら 400 INVALID_IDEA で、何も記録しない", async (_, text) => {
    const f = fakes();
    const response = await generate(f, text);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("INVALID_IDEA");
    expect(f.kinds()).toEqual([]);
  });

  it("メンバーでなければ 403", async () => {
    const f = fakes({ role: "NONE" });
    expect((await generate(f)).status).toBe(403);
    expect(f.kinds()).toEqual([]);
  });

  it("AC-002-03 背景写真の候補に無いIDは違反（作り直す）、候補が0枚なら選んだIDを捨てて null（紺の単色）にする", async () => {
    const unknown = fakes({ gemini: [okStep(draft({ backgroundPhotoId: "ghost" }))] });
    const error = await errorOf(await generate(unknown));
    expect(error.details).toEqual(["背景写真のIDが候補にありません: ghost"]);
    const none = fakes({ photos: [] });
    const body = await (await generate(none)).json() as { proposal: { backgroundPhotoId: string | null } };
    expect(body.proposal.backgroundPhotoId).toBeNull();
    expect(none.only("gemini")[0].body.contents[0].parts[0].text).toContain("写真:\nなし");
  });

  it("記録に失敗したら 500（生成の成功は返さない）", async () => {
    const f = fakes({ recordFails: true });
    expect((await generate(f)).status).toBe(500);
  });
});

describe("POST /api/drafts/{generationId}/revise", () => {
  const current = () => draft({ prCategory: "PR", backgroundPhotoId: "bg2", sourceUrls: ["https://example.com/a"] });
  const revise = (f: Fakes, overrides: Record<string, unknown> = {}, id = PARENT) =>
    f.post(`/api/drafts/${id}/revise`, { instruction: "もっとくだけた感じで", current: current(), ...overrides });

  it("AC-002-05 文言だけ作り直し、PR区分・参照元URLは保ち、背景写真は変えず、修正指示と元の生成IDを記録する", async () => {
    const revised = draft({ prCategory: "NONE", backgroundPhotoId: "bg1", sourceUrls: [], caption: "くだけた感じに直しました😀", cover: { ...draft().cover, keyword: "テスト期間" } });
    const f = fakes({ gemini: [okStep(revised)] });
    const response = await revise(f);
    const body = await response.json() as { proposal: ReturnType<typeof draft>; parentGenerationId: string; ideaId: string };
    expect(response.status).toBe(201);
    expect(body.parentGenerationId).toBe(PARENT);
    expect(body.ideaId).toBe(PARENT_IDEA);
    expect(body.proposal).toMatchObject({ prCategory: "PR", backgroundPhotoId: null, sourceUrls: ["https://example.com/a"], caption: "くだけた感じに直しました😀" });
    expect(body.proposal.cover.keyword).toBe("テスト期間");
    expect(f.kinds()).toEqual(["llm", "gemini", "generation"]);
    expect(f.recorded()).toMatchObject({ p_purpose: "REVISE", p_route: "API", p_parent: PARENT, p_instruction: "もっとくだけた感じで",
      p_idea: PARENT_IDEA, p_prompt_version: REVISE_VERSION, p_outcome: "SUCCEEDED" });
    expect(f.recorded().p_input.revision).toMatchObject({ instruction: "もっとくだけた感じで", bodySlideCount: 3 });
  });

  it("AC-002-05 スキーマで中のスライドの枚数を入力と同じ（3枚）に固定し、プロンプトに修正指示・現在の下書き・枚数を差し込む", async () => {
    const f = fakes();
    await revise(f);
    const request = f.only("gemini")[0].body;
    expect(request.generationConfig.responseSchema.properties.slides).toMatchObject({ minItems: 3, maxItems: 3 });
    const prompt: string = request.contents[0].parts[0].text;
    expect(prompt).toContain("指示:もっとくだけた感じで");
    expect(prompt).toContain("枚数:3");
    expect(prompt).toContain("\"keyword\": \"期末試験\"");
  });

  it("AC-002-05 枚数が違う出力は違反。2回続けば 502 で、違反に枚数の違いを示す", async () => {
    const f = fakes({ gemini: [okStep(draft({ slides: [slide(1), slide(2)] }))] });
    const response = await revise(f);
    expect(response.status).toBe(502);
    expect((await errorOf(response)).details).toEqual(["中のスライドは3枚にしてください（2枚）"]);
    expect(f.recorded()).toMatchObject({ p_outcome: "INVALID_OUTPUT", p_parent: PARENT });
  });

  it("元の生成が無ければ 404（IDの形が違うときは問い合わせずに 404）、他団体のものは 403", async () => {
    const f = fakes();
    expect((await revise(f, {}, UNKNOWN)).status).toBe(404);
    expect((await revise(f, {}, "not-a-uuid")).status).toBe(404);
    expect((await revise(f, {}, OTHER_TENANT_PARENT)).status).toBe(403);
    expect(f.kinds()).toEqual([]);
  });

  it.each([["修正指示が空", { instruction: "" }], ["修正指示が501文字", { instruction: "あ".repeat(501) }],
    ["現在の下書きが無い", { current: undefined }], ["現在の下書きの形が違う", { current: { cover: {} } }],
    ["現在の下書きの中のスライドが0枚", { current: draft({ slides: [] }) }]])("%s なら 400 で何も呼ばない", async (_, overrides) => {
    const f = fakes();
    const response = await revise(f, overrides);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("INVALID_REQUEST");
    expect(f.kinds()).toEqual([]);
  });

  it("上限なら 409（ideaId つき）で、QUOTA_EXCEEDED を親の生成つきで記録する", async () => {
    const f = fakes({ used: 100 });
    const response = await revise(f);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).ideaId).toBe(PARENT_IDEA);
    expect(f.recorded()).toMatchObject({ p_outcome: "QUOTA_EXCEEDED", p_parent: PARENT });
  });
});

describe("手動コピペ", () => {
  it("AC-002-07 プロンプトを得ると、ネタを記録して ideaId・プロンプト版ID・差し込み済みのプロンプトを返し、回数は数えない", async () => {
    const f = fakes();
    const response = await f.post("/api/drafts/manual-prompt", { ideaText: IDEA_TEXT });
    const body = await response.json() as { ideaId: string; promptVersionId: string; prompt: string };
    expect(response.status).toBe(201);
    expect(body.promptVersionId).toBe(PLAN_VERSION);
    expect(body.prompt).toContain(`ネタ:${IDEA_TEXT}`);
    expect(body.prompt).toContain("bg1: 正門");
    expect(f.kinds()).toEqual(["idea"]);
    expect(f.only("idea")[0].body.p_id).toBe(body.ideaId);
  });

  it("AC-002-07 ideaId があれば、ネタを新しく記録せずに再利用する。他団体のネタは 403、無ければ 404", async () => {
    const f = fakes();
    const reuse = await f.post("/api/drafts/manual-prompt", { ideaId: PARENT_IDEA });
    expect((await reuse.json() as { ideaId: string; prompt: string })).toMatchObject({ ideaId: PARENT_IDEA, prompt: expect.stringContaining(IDEA_TEXT) });
    expect(f.kinds()).toEqual([]);
    expect((await f.post("/api/drafts/manual-prompt", { ideaId: OTHER_TENANT_IDEA })).status).toBe(403);
    expect((await f.post("/api/drafts/manual-prompt", { ideaId: UNKNOWN })).status).toBe(404);
  });

  it("手動コピペのプロンプトもネタが不正なら 400、投稿の型の設定が無ければ 409（何も記録しない）", async () => {
    const f = fakes();
    expect((await f.post("/api/drafts/manual-prompt", { ideaText: "" })).status).toBe(400);
    const noStyle = fakes({ styleMissing: true });
    expect((await noStyle.post("/api/drafts/manual-prompt", { ideaText: IDEA_TEXT })).status).toBe(409);
    expect(noStyle.kinds()).toEqual([]);
  });

  it("修正のプロンプトは、修正指示と現在の下書きを差し込んだ REVISE のプロンプトになる", async () => {
    const f = fakes();
    const body = await (await f.post("/api/drafts/manual-prompt", { ideaId: PARENT_IDEA, instruction: "短く", current: draft() })).json() as { prompt: string; promptVersionId: string };
    expect(body.promptVersionId).toBe(REVISE_VERSION);
    expect(body.prompt).toContain("指示:短く");
    expect(body.prompt).toContain("枚数:3");
    expect((await f.post("/api/drafts/manual-prompt", { ideaId: PARENT_IDEA, instruction: "短く" })).status).toBe(400);
  });

  it("AC-002-07 正しい JSON は下書き案として取り込み、生成経路 MANUAL・試行0行で記録する。LLM利用回数は増えない", async () => {
    const f = fakes();
    const response = await f.post("/api/drafts/manual", { ideaId: PARENT_IDEA, promptVersionId: PLAN_VERSION, json: `\`\`\`json\n${JSON.stringify(draft())}\n\`\`\`` });
    const body = await response.json() as { generationId: string; proposal: unknown; usage: unknown };
    expect(response.status).toBe(201);
    expect(body.usage).toBeNull();
    expect(f.kinds()).toEqual(["generation"]);
    expect(f.recorded()).toMatchObject({ p_id: body.generationId, p_route: "MANUAL", p_purpose: "PLAN", p_outcome: "SUCCEEDED", p_attempts: [],
      p_idea: PARENT_IDEA, p_prompt_version: PLAN_VERSION });
    expect(f.recorded().p_result).toEqual(body.proposal);
  });

  it.each([
    ["JSON でない貼り付け", "これは JSON ではありません", "JSON として読めません"],
    ["形が違う JSON", JSON.stringify({ cover: {} }), "slides は配列で指定してください"],
    ["キーワードが13文字", JSON.stringify(draft({ cover: { ...draft().cover, keyword: "あ".repeat(13) } })), "キーワードは1〜12文字にしてください（13文字）"],
  ])("AC-002-07 %s は 400 INVALID_OUTPUT で場所つきの違反を返し、下書き案にせず、回数も増えない", async (_, json, violation) => {
    const f = fakes();
    const response = await f.post("/api/drafts/manual", { ideaId: PARENT_IDEA, promptVersionId: PLAN_VERSION, json });
    const error = await errorOf(response);
    expect(response.status).toBe(400);
    expect(error.code).toBe("INVALID_OUTPUT");
    expect(error.details.join("\n")).toContain(violation);
    expect(f.kinds()).toEqual([]);
  });

  it("オブジェクトのまま渡された json も取り込める", async () => {
    const f = fakes();
    expect((await f.post("/api/drafts/manual", { ideaId: PARENT_IDEA, promptVersionId: PLAN_VERSION, json: draft() })).status).toBe(201);
  });

  it("修正の取り込みは、元の生成・修正指示・現在の下書きを添え、PR区分を保ち、親の生成つきで記録する", async () => {
    const f = fakes();
    const response = await f.post("/api/drafts/manual", { ideaId: PARENT_IDEA, promptVersionId: REVISE_VERSION, json: draft({ prCategory: "NONE" }),
      parentGenerationId: PARENT, instruction: "短く", current: draft({ prCategory: "PR" }) });
    const body = await response.json() as { proposal: { prCategory: string }; parentGenerationId: string };
    expect(response.status).toBe(201);
    expect(body.proposal.prCategory).toBe("PR");
    expect(body.parentGenerationId).toBe(PARENT);
    expect(f.recorded()).toMatchObject({ p_purpose: "REVISE", p_route: "MANUAL", p_parent: PARENT, p_instruction: "短く" });
    const missing = await f.post("/api/drafts/manual", { ideaId: PARENT_IDEA, promptVersionId: REVISE_VERSION, json: draft() });
    expect(missing.status).toBe(400);
  });

  it("プロンプト版が無ければ 404、他団体のものは 403、ネタが違えば 404", async () => {
    const f = fakes();
    const call = (body: Record<string, unknown>) => f.post("/api/drafts/manual", { json: draft(), ...body });
    expect((await call({ ideaId: PARENT_IDEA, promptVersionId: UNKNOWN })).status).toBe(404);
    expect((await call({ ideaId: PARENT_IDEA, promptVersionId: OTHER_TENANT_VERSION })).status).toBe(403);
    expect((await call({ ideaId: UNKNOWN, promptVersionId: PLAN_VERSION })).status).toBe(404);
    expect(f.kinds()).toEqual([]);
  });
});
