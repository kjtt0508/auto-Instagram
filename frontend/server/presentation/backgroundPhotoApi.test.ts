import { describe, expect, it, vi } from "vitest";
import { GenerationInput } from "../../src/domain/draft/GenerationInput";
import { SupabaseDraftRecords } from "../draft/infrastructure/supabaseDraftRecords";
import { apiAssembly, type ApiEnv } from "../shared/infrastructure/apiAssembly";
import { SupabaseService } from "../shared/infrastructure/supabaseService";
import { createApiApp } from "./apiApp";

// 生成した背景を背景写真にする API（REQ-006 設計 4・6・7章）。Supabase（DB・Storage）は偽物
const SERVICE_KEY = "service-role-secret";
const USER_TOKEN = "user-access-token-secret";
const GEN_OK = "0b9e7c1e-0000-4000-8000-0000000000a1";
const GEN_TWO_CANDIDATES = "0b9e7c1e-0000-4000-8000-0000000000a2";
const GEN_FAILED = "0b9e7c1e-0000-4000-8000-0000000000a3";
const GEN_PHOTOREALISTIC = "0b9e7c1e-0000-4000-8000-0000000000a4";
const GEN_OTHER_TENANT = "0b9e7c1e-0000-4000-8000-0000000000a5";
const GEN_ADOPTED = "0b9e7c1e-0000-4000-8000-0000000000a6";
const GEN_UNKNOWN = "0b9e7c1e-0000-4000-8000-0000000000a7";
const FILE_ID = "0b9e7c1e-0000-4000-8000-0000000000f1";
const EXISTING_PHOTO = { id: "photo-existing", tenant_id: "t1", storage_path: "t1/backgrounds/existing.jpg", description: "先に作った背景" };
const LIMIT_MESSAGE = "背景写真は使う写真を30枚までです。使わない写真を増やしてから足してください";

type World = {
  role?: string;
  candidatesGone?: boolean;                  // 候補の画像が片付け済み
  storage?: "info-down" | "info-bad-request" | "copy-down";   // Storage の失敗（info-bad-request は鍵の誤りなどの 400。「無い」ではない）
  rpc?: "ok" | "limit" | "other-rejection" | "wording-only" | "not-found" | "bad-path" | "down" | "race-lost"
    | "lost-committed" | "lost-uncommitted";   // lost-*: 応答が届かない（結果が分からない）。committed は DB に記録済み
  adoptedRetired?: boolean;                  // 採用済みの背景写真を、管理者が「使わない」にしている
  adoptionReadFailsAfterRpc?: boolean;       // 記録の結果を確かめる読み取りが失敗する
};

const generations: Record<string, { tenant_id: string; style: string; outcome: string; candidate_count: number }> = {
  [GEN_OK]: { tenant_id: "t1", style: "ILLUSTRATION", outcome: "SUCCEEDED", candidate_count: 4 },
  [GEN_TWO_CANDIDATES]: { tenant_id: "t1", style: "ILLUSTRATION", outcome: "SUCCEEDED", candidate_count: 2 },
  [GEN_FAILED]: { tenant_id: "t1", style: "ILLUSTRATION", outcome: "FAILED", candidate_count: 0 },
  [GEN_PHOTOREALISTIC]: { tenant_id: "t1", style: "PHOTOREALISTIC", outcome: "SUCCEEDED", candidate_count: 4 },
  [GEN_OTHER_TENANT]: { tenant_id: "t2", style: "ILLUSTRATION", outcome: "SUCCEEDED", candidate_count: 4 },
  [GEN_ADOPTED]: { tenant_id: "t1", style: "ILLUSTRATION", outcome: "SUCCEEDED", candidate_count: 4 },
};

type Call = { kind: string; detail: string; body?: any; authorization?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

const bytesOf = (text: string) => new TextEncoder().encode(text);

function fakes(world: World = {}) {
  const calls: Call[] = [];
  const storage = new Map<string, Uint8Array>();
  for (const [id, g] of Object.entries(generations)) {
    for (let p = 1; p <= g.candidate_count; p += 1) storage.set(`${g.tenant_id}/candidates/${id}/${p}.jpg`, bytesOf(`jpeg-${id}-${p}`));
  }
  if (world.candidatesGone) for (const path of [...storage.keys()].filter((k) => k.includes("/candidates/"))) storage.delete(path);
  const photos = new Map<string, typeof EXISTING_PHOTO>([[EXISTING_PHOTO.id, EXISTING_PHOTO]]);
  const adoptions = new Map<string, typeof EXISTING_PHOTO>([[`${GEN_ADOPTED}:1`, EXISTING_PHOTO]]);   // 「画像生成ID:位置」→ 背景写真
  let rpcCalled = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const authorizationOf = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization;
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = decodeURIComponent(String(input));
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    if (url.endsWith("/auth/v1/user")) return json({ id: "user-1" });
    if (url.includes("/rest/v1/member_current")) return json(world.role === "NONE" ? [] : [{ member_id: "m1", tenant_id: "t1", role: world.role ?? "EDITOR" }]);
    if (url.includes("/rest/v1/image_generations?")) {
      const row = generations[url.split("id=eq.")[1]];
      return json(row ? [row] : []);
    }
    if (url.includes("/rest/v1/background_photo_adoptions?")) {
      if (rpcCalled && world.adoptionReadFailsAfterRpc) return json({ message: "db down" }, 500);
      const key = `${url.split("generation_id=eq.")[1].split("&")[0]}:${url.split("candidate_position=eq.")[1]}`;
      const adopted = adoptions.get(key);
      if (!adopted) return json([]);
      const retirement = key === `${GEN_ADOPTED}:1` && world.adoptedRetired ? { background_photo_id: adopted.id } : null;   // 「使わない」にした出来事
      return json([{ background_photos: { ...adopted, background_photo_retirements: retirement } }]);
    }
    if (url.includes("/rest/v1/background_photos?")) {
      const photo = photos.get(url.split("&id=eq.")[1].split("&")[0]);
      return json(photo ? [photo] : []);
    }
    if (url.includes("/storage/v1/object/info/uploads-private/")) {
      calls.push({ kind: "exists", detail: url.split("uploads-private/")[1] });
      if (world.storage === "info-down") return json({ message: "storage down" }, 500);
      if (world.storage === "info-bad-request") return json({ statusCode: "400", error: "Invalid Compact JWS", message: "Invalid Compact JWS" }, 400);
      return storage.has(url.split("uploads-private/")[1]) ? json({ name: "x" }) : json({ statusCode: "404", error: "not_found" }, 400);
    }
    if (url.endsWith("/storage/v1/object/copy")) {
      calls.push({ kind: "copy", detail: `${body.sourceKey} -> ${body.destinationKey}`, body });
      if (world.storage === "copy-down") return json({ message: "storage down" }, 500);
      storage.set(body.destinationKey, new Uint8Array(storage.get(body.sourceKey)!));
      return json({ Key: body.destinationKey });
    }
    if (url.endsWith("/storage/v1/object/uploads-private") && init?.method === "DELETE") {
      calls.push({ kind: "delete", detail: body.prefixes.join(","), body });
      for (const path of body.prefixes as string[]) storage.delete(path);
      return json([]);
    }
    if (url.includes("/rest/v1/rpc/record_generated_background")) {
      calls.push({ kind: "rpc", detail: "", body, authorization: authorizationOf(init) });
      rpcCalled = true;
      const commit = () => {
        const created = { id: `photo-${photos.size}`, tenant_id: body.p_tenant, storage_path: body.p_storage_path, description: body.p_description };
        photos.set(created.id, created);
        adoptions.set(`${body.p_generation}:${body.p_position}`, created);
        return created;
      };
      if (world.rpc === "lost-committed") { commit(); throw new TypeError("fetch failed"); }   // DB には記録されたが、応答が届かない
      if (world.rpc === "lost-uncommitted") throw new TypeError("fetch failed");               // DB に届かなかった
      if (world.rpc === "limit") return json({ code: "P0409", message: LIMIT_MESSAGE }, 400);
      if (world.rpc === "other-rejection") return json({ code: "22023", message: "採用できない候補です" }, 400);
      if (world.rpc === "wording-only") return json({ code: "22023", message: LIMIT_MESSAGE }, 400);   // 文言に30枚があっても、SQLSTATE が 22023 なら上限ではない
      if (world.rpc === "not-found") return json({ code: "P0404", message: "メンバーが見つかりません" }, 400);
      if (world.rpc === "bad-path") return json({ code: "42501", message: "背景写真の保存先が正しくありません" }, 403);
      if (world.rpc === "down") return json({ message: `db down ${SERVICE_KEY}` }, 500);
      if (world.rpc === "race-lost") return json(EXISTING_PHOTO.id);   // 同時に同じ候補を採用した相手が先に記録していた
      return json(commit().id);
    }
    return json({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  const env = { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, TOKEN_ENC_KEY_V1: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    IG_APP_ID: "", IG_APP_SECRET: "", IG_REDIRECT_URI: "", IG_API_VERSION: "", GEMINI_API_KEY: "gemini-key", AI: { run: async () => ({}) } } satisfies ApiEnv;
  const app = createApiApp(apiAssembly(http, () => FILE_ID));
  const post = (body?: unknown) => app.request("/api/background-photos", {
    method: "POST", headers: { Authorization: `Bearer ${USER_TOKEN}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  return { post, calls, storage, kinds: () => calls.map((c) => c.kind) };
}

type Fakes = ReturnType<typeof fakes>;
const adopt = (f: Fakes, overrides: Record<string, unknown> = {}) =>
  f.post({ generationId: GEN_OK, candidatePosition: 2, description: "夕暮れの京都御苑、やわらかい光", ...overrides });
const errorOf = async (response: Response) => (await response.json() as { error: { code: string; message: string; details: string[] } }).error;

describe("POST /api/background-photos", () => {
  it("AC-006-04 AC-006-09 編集者が候補を背景写真にできる。候補の画像を団体の backgrounds/ に複製し、service role で記録する", async () => {
    const f = fakes({ role: "EDITOR" });
    const response = await adopt(f);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ photoId: "photo-1", storagePath: `t1/backgrounds/${FILE_ID}.jpg`, description: "夕暮れの京都御苑、やわらかい光" });
    expect(f.kinds()).toEqual(["exists", "copy", "rpc"]);
    expect(f.calls[0].detail).toBe(`t1/candidates/${GEN_OK}/2.jpg`);
    expect(f.calls[1].detail).toBe(`t1/candidates/${GEN_OK}/2.jpg -> t1/backgrounds/${FILE_ID}.jpg`);
    expect(f.calls[2].body).toEqual({ p_tenant: "t1", p_member: "m1", p_storage_path: `t1/backgrounds/${FILE_ID}.jpg`,
      p_generation: GEN_OK, p_position: 2, p_description: "夕暮れの京都御苑、やわらかい光" });
    expect(f.calls[2].authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it.each([["編集者", "EDITOR"], ["承認者", "APPROVER"], ["管理者", "ADMIN"]])("AC-006-09 全ロール（%s）が背景写真にできる", async (_, role) => {
    expect((await adopt(fakes({ role }))).status).toBe(201);
  });

  it("AC-006-04 複製した画像の中身は候補のバイト列と同じ（画像は加工しない）。候補の画像は残る", async () => {
    const f = fakes();
    await adopt(f);
    expect(f.storage.get(`t1/backgrounds/${FILE_ID}.jpg`)).toEqual(bytesOf(`jpeg-${GEN_OK}-2`));
    expect(f.storage.has(`t1/candidates/${GEN_OK}/2.jpg`)).toBe(true);
  });

  it("AC-006-09 メンバーでなければ 403 で、何も読まず複製も記録もしない", async () => {
    const f = fakes({ role: "NONE" });
    const response = await adopt(f);
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe("FORBIDDEN");
    expect(f.kinds()).toEqual([]);
  });

  it("AC-006-09 AC-006-10 他団体の画像生成・存在しない画像生成・UUID でない画像生成IDは 404 で、複製も記録もしない", async () => {
    for (const generationId of [GEN_OTHER_TENANT, GEN_UNKNOWN, "not-a-uuid"]) {
      const f = fakes();
      const response = await adopt(f, { generationId });
      expect(response.status).toBe(404);
      expect((await errorOf(response)).code).toBe("NOT_FOUND");
      expect(f.kinds()).toEqual([]);
    }
  });

  it("AC-006-10 候補の画像が残っていない（片付け済み）なら 409 CANDIDATE_GONE で、複製も記録もしない", async () => {
    const f = fakes({ candidatesGone: true });
    const response = await adopt(f);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("CANDIDATE_GONE");
    expect(f.kinds()).toEqual(["exists"]);
  });

  it.each([
    ["失敗した画像生成", { generationId: GEN_FAILED, candidatePosition: 1 }],
    ["位置が候補の数を超える", { generationId: GEN_TWO_CANDIDATES, candidatePosition: 3 }],
    ["位置が4を超える", { generationId: GEN_OK, candidatePosition: 5 }],
  ])("AC-006-10 %sは 409 NOT_ADOPTABLE で、複製も記録もしない", async (_, overrides) => {
    const f = fakes();
    const response = await adopt(f, overrides);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("NOT_ADOPTABLE");
    expect(f.kinds()).toEqual([]);
  });

  it("AC-006-06 写真風の候補を直接背景写真にしようとしても 409 NOT_ADOPTABLE で、複製も記録もしない", async () => {
    const f = fakes();
    const response = await adopt(f, { generationId: GEN_PHOTOREALISTIC });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("NOT_ADOPTABLE");
    expect(f.kinds()).toEqual([]);
  });

  it.each([
    ["22023（採用できない候補・説明文の形など）", "other-rejection", 409, "NOT_ADOPTABLE"],
    ["22023（文言に30枚があっても SQLSTATE だけで判断する）", "wording-only", 409, "NOT_ADOPTABLE"],
    ["P0404（団体・メンバーが無い）", "not-found", 404, "NOT_FOUND"],
    ["42501（保存先の形）", "bad-path", 502, "STORAGE_FAILED"],
  ] as const)("AC-006-10 RPC の拒否 %s は %i %s にし、複製した画像を消す", async (_, rpc, status, code) => {
    const f = fakes({ rpc });
    const response = await adopt(f);
    expect(response.status).toBe(status);
    expect((await errorOf(response)).code).toBe(code);
    expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(false);
  });

  it("AC-006-07 NFR-006-04 背景写真が30枚なら（RPC の P0409）409 BACKGROUND_LIMIT_REACHED で、複製した画像を消す", async () => {
    const f = fakes({ rpc: "limit" });
    const response = await adopt(f);
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("BACKGROUND_LIMIT_REACHED");
    expect(f.kinds()).toEqual(["exists", "copy", "rpc", "delete"]);
    expect(f.calls[3].body).toEqual({ prefixes: [`t1/backgrounds/${FILE_ID}.jpg`] });
    expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(false);
  });

  it("AC-006-10 同じ候補をもう一度採用したら、新しく作らず同じ背景写真を 200 で返す（複製も記録もしない。候補が片付け済みでもよい）", async () => {
    const f = fakes({ candidatesGone: true });
    const response = await adopt(f, { generationId: GEN_ADOPTED, candidatePosition: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photoId: "photo-existing", storagePath: "t1/backgrounds/existing.jpg", description: "先に作った背景" });
    expect(f.kinds()).toEqual([]);
  });

  it("AC-006-10 同時に同じ候補を採用して先を越されたら（RPC が既存の背景写真IDを返す）、自分の複製を消して 200 で既存を返す", async () => {
    const f = fakes({ rpc: "race-lost" });
    const response = await adopt(f);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photoId: "photo-existing", storagePath: "t1/backgrounds/existing.jpg", description: "先に作った背景" });
    expect(f.kinds()).toEqual(["exists", "copy", "rpc", "delete"]);
    expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(false);
  });

  it("AC-006-04 記録（RPC）に失敗したら、複製した画像を消して失敗にする（孤児を残さない）。理由に鍵は出ない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const f = fakes({ rpc: "down" });
      const response = await adopt(f);
      expect(response.status).toBe(500);
      expect(f.kinds()).toEqual(["exists", "copy", "rpc", "delete"]);
      expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(false);
      expect(await response.text()).not.toContain(SERVICE_KEY);
      expect(error.mock.calls.flat().join("\n")).not.toContain(SERVICE_KEY);
    } finally {
      error.mockRestore();
    }
  });

  it("AC-006-10 採用済みでも管理者が「使わない」にした背景は、200 で返さず 409 NOT_ADOPTABLE にする（複製も記録もしない。RPC の拒否と食い違わない）", async () => {
    const f = fakes({ adoptedRetired: true });
    const response = await adopt(f, { generationId: GEN_ADOPTED, candidatePosition: 1 });
    expect(response.status).toBe(409);
    expect((await errorOf(response)).code).toBe("NOT_ADOPTABLE");
    expect(f.kinds()).toEqual([]);
  });

  it("AC-006-10 採用済みで使っている背景は、これまでどおり 200 で返す", async () => {
    const response = await adopt(fakes({ adoptedRetired: false }), { generationId: GEN_ADOPTED, candidatePosition: 1 });
    expect(response.status).toBe(200);
  });

  it("AC-006-04 結果が分からない失敗（応答が届かない）で、DB に記録済みなら、成功として返し複製は消さない（参照先の無い背景写真を作らない）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const f = fakes({ rpc: "lost-committed" });
      const response = await adopt(f);
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ storagePath: `t1/backgrounds/${FILE_ID}.jpg` });
      expect(f.kinds()).toEqual(["exists", "copy", "rpc"]);
      expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("AC-006-04 結果が分からない失敗で、DB に記録が無ければ、複製を消して失敗にする", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const f = fakes({ rpc: "lost-uncommitted" });
      expect((await adopt(f)).status).toBe(500);
      expect(f.kinds()).toEqual(["exists", "copy", "rpc", "delete"]);
      expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  it("AC-006-04 結果が分からない失敗で、記録を確かめる読み取りも失敗したら、複製は消さずに 502 にする", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const f = fakes({ rpc: "lost-committed", adoptionReadFailsAfterRpc: true });
      const response = await adopt(f);
      expect(response.status).toBe(502);
      expect(f.kinds()).toEqual(["exists", "copy", "rpc"]);
      expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("AC-006-10 確定した拒否（SQLSTATE が分かる）のときだけ複製を消す。確定した拒否では記録の読み直しをしない", async () => {
    const f = fakes({ rpc: "other-rejection", adoptionReadFailsAfterRpc: true });
    expect((await adopt(f)).status).toBe(409);
    expect(f.storage.has(`t1/backgrounds/${FILE_ID}.jpg`)).toBe(false);
  });

  it.each([["存在の確認", "info-down"], ["存在の確認（無いのではない 400）", "info-bad-request"], ["複製", "copy-down"]] as const)("AC-006-04 Storage の失敗（%s）は 502 STORAGE_FAILED で、記録しない", async (_, storage) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const f = fakes({ storage });
      const response = await adopt(f);
      expect(response.status).toBe(502);
      expect((await errorOf(response)).code).toBe("STORAGE_FAILED");
      expect(f.kinds()).not.toContain("rpc");
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["0文字", ""],
    ["空白だけ", "   "],
    ["101文字", "あ".repeat(101)],
    ["改行を含む", "夕暮れの\n京都御苑"],
    ["行の区切りを含む", "夕暮れの 京都御苑"],
    ["制御文字を含む", "夕暮れの\u0007京都御苑"],
  ])("AC-006-04 説明文が不正（%s）なら 400 INVALID_REQUEST で、何も読まない", async (_, description) => {
    const f = fakes();
    const response = await adopt(f, { description });
    expect(response.status).toBe(400);
    const error = await errorOf(response);
    expect(error.code).toBe("INVALID_REQUEST");
    expect(error.details.length).toBeGreaterThan(0);
    expect(f.kinds()).toEqual([]);
  });

  it.each([["1文字", "あ"], ["100文字", "あ".repeat(100)]])("AC-006-04 説明文が%sなら受け付ける", async (_, description) => {
    expect((await adopt(fakes(), { description })).status).toBe(201);
  });

  it.each([["0", 0], ["小数", 1.5], ["文字列", "2"], ["無い", undefined]])("AC-006-04 候補の位置が不正（%s）なら 400 INVALID_REQUEST", async (_, candidatePosition) => {
    const f = fakes();
    const response = await adopt(f, { candidatePosition });
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe("INVALID_REQUEST");
    expect(f.kinds()).toEqual([]);
  });

  it("NFR-006-03 鍵（service role）とアクセストークンは、成功・失敗のどのレスポンスにも出ない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const responses = [
        await adopt(fakes()), await adopt(fakes({ rpc: "limit" })), await adopt(fakes({ rpc: "down" })), await adopt(fakes({ storage: "copy-down" })),
        await adopt(fakes({ role: "NONE" })), await adopt(fakes(), { generationId: GEN_OTHER_TENANT }), await adopt(fakes(), { description: "" }),
      ];
      for (const response of responses) {
        const text = await response.text();
        expect(text).not.toContain(SERVICE_KEY);
        expect(text).not.toContain(USER_TOKEN);
      }
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

describe("Storage の存在確認（SupabaseService.existsPrivate）", () => {
  const serviceReturning = (response: () => Response) =>
    new SupabaseService({ url: "https://db.test", serviceRoleKey: SERVICE_KEY }, (async () => response()) as typeof fetch);

  it("AC-006-10 404、または 400 で本文の statusCode が 404（Storage の旧い返し方）なら「無い」。画像があれば true", async () => {
    expect(await serviceReturning(() => new Response("{}", { status: 404 })).existsPrivate("t1/a.jpg")).toBe(false);
    expect(await serviceReturning(() => new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), { status: 400 })).existsPrivate("t1/a.jpg")).toBe(false);
    expect(await serviceReturning(() => new Response("{}", { status: 200 })).existsPrivate("t1/a.jpg")).toBe(true);
  });

  it("AC-006-10 鍵の誤りなどの 400・500 は「無い」に見せず例外にする（候補が片付け済みに見えない）", async () => {
    await expect(serviceReturning(() => new Response(JSON.stringify({ statusCode: "400", error: "Invalid Compact JWS" }), { status: 400 })).existsPrivate("t1/a.jpg")).rejects.toThrow("400");
    await expect(serviceReturning(() => new Response("not json", { status: 400 })).existsPrivate("t1/a.jpg")).rejects.toThrow("400");
    await expect(serviceReturning(() => new Response("{}", { status: 500 })).existsPrivate("t1/a.jpg")).rejects.toThrow("500");
  });
});

describe("下書き案を作るときの背景写真の候補（AC-006-11）", () => {
  it("AC-006-11 背景写真の一覧は usable_background_photos から読む（AI が作った背景も含まれる）ので、PLAN の入力の {{backgroundPhotos}} に出る", async () => {
    const requested: string[] = [];
    const http = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify([{ id: "bg1", description: "正門" }, { id: "bg-ai", description: "夕暮れの京都御苑、やわらかい光" }]), { status: 200 });
    }) as typeof fetch;
    const records = new SupabaseDraftRecords(new SupabaseService({ url: "https://db.test", serviceRoleKey: SERVICE_KEY }, http));
    const photos = await records.usableBackgroundPhotos("t1");
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("/rest/v1/usable_background_photos?");
    const input = GenerationInput.forPlan({ ideaText: "・学割", today: "2026-10-11", coverTargets: ["同志社大学"], backgroundPhotos: photos });
    expect(input.placeholders().backgroundPhotos).toBe("bg1: 正門\nbg-ai: 夕暮れの京都御苑、やわらかい光");
  });
});
