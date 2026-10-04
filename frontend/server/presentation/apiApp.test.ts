import { beforeEach, describe, expect, it, vi } from "vitest";
import vector from "../../../docs/model/fixtures/token-cipher.json";
import { AccessToken } from "../../src/domain/connection/AccessToken";
import { TokenCipher } from "../connection/infrastructure/tokenCipher";
import { apiAssembly, type ApiEnv } from "../shared/infrastructure/apiAssembly";
import { createApiApp as createApp } from "./apiApp";

const createApiApp = (http: typeof fetch) => createApp(apiAssembly(http));

const env: ApiEnv = {
  SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "service-role", TOKEN_ENC_KEY_V1: vector.keyBase64,
  IG_APP_ID: "app", IG_APP_SECRET: "secret", IG_REDIRECT_URI: "https://admin.test/api/instagram/callback", IG_API_VERSION: "v23.0",
  GEMINI_API_KEY: "gemini-key", AI: { run: async () => ({}) },
};
const LONG_TOKEN = "IGAA-long-lived-secret";

/** Supabase と Instagram の偽物。受け取った要求を記録する */
function fakeServices(options: { role?: string; accountType?: string; stateExpired?: boolean; recordFails?: boolean } = {}) {
  const calls: { url: string; body: string }[] = [];
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/auth/v1/user")) return respond({ id: "user-1" });
    if (url.includes("/rest/v1/member_current")) return respond(options.role ? [{ member_id: "m1", tenant_id: "t1", role: options.role }] : []);
    if (url.includes("/rest/v1/oauth_states?state=eq.good")) {
      const expires = options.stateExpired ? "2000-01-01T00:00:00Z" : "2999-01-01T00:00:00Z";
      return respond([{ tenant_id: "t1", member_id: "m1", expires_at: expires }]);
    }
    if (url.includes("/rest/v1/oauth_states")) return respond([]);
    if (url.includes("/rest/v1/rpc/record_instagram_connection")) {
      return options.recordFails ? respond({ message: `failed for ${init?.body}` }, 500) : new Response(null, { status: 204 });
    }
    if (url.includes("api.instagram.com/oauth/access_token")) return respond({ access_token: "short", user_id: 1 });
    if (url.includes("graph.instagram.com/access_token")) return respond({ access_token: LONG_TOKEN, expires_in: 5184000 });
    if (url.includes("/me?")) return respond({ user_id: "1784", username: "niijima_info", account_type: options.accountType ?? "BUSINESS" });
    return respond({ error: "unexpected" }, 500);
  }) as typeof fetch;
  return { http, calls };
}

describe("POST /api/instagram/connect", () => {
  it("管理者には認可 URL を返し、state を保存する", async () => {
    const { http, calls } = fakeServices({ role: "ADMIN" });
    const response = await createApiApp(http).request("/api/instagram/connect", { method: "POST", headers: { Authorization: "Bearer jwt" } }, env);
    const body = await response.json() as { authorizeUrl: string };
    expect(response.status).toBe(200);
    expect(body.authorizeUrl).toMatch(/^https:\/\/www\.instagram\.com\/oauth\/authorize\?.*state=/);
    expect(calls.some((c) => c.url.endsWith("/rest/v1/oauth_states") && c.body.includes("\"tenant_id\":\"t1\""))).toBe(true);
  });

  it.each([["承認者", "APPROVER"], ["メンバーでない", undefined]])("%sは 403", async (_, role) => {
    const { http } = fakeServices({ role });
    const response = await createApiApp(http).request("/api/instagram/connect", { method: "POST", headers: { Authorization: "Bearer jwt" } }, env);
    expect(response.status).toBe(403);
  });
});

describe("GET /api/instagram/callback", () => {
  let services: ReturnType<typeof fakeServices>;
  beforeEach(() => {
    services = fakeServices();
  });
  const callback = (query: string, s = services) => createApiApp(s.http).request(`/api/instagram/callback?${query}`, {}, env);

  it("AC-001-03 NFR-001-03 連携を記録して設定画面へ戻す。トークンは暗号化して渡し、平文はどこにも出さない", async () => {
    const response = await callback("code=c&state=good");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/settings/?instagram=connected");
    expect(await response.text()).not.toContain(LONG_TOKEN);
    const record = services.calls.find((c) => c.url.includes("record_instagram_connection"))!;
    expect(record.body).not.toContain(LONG_TOKEN);
    const sent = JSON.parse(record.body);
    const cipher = await TokenCipher.fromBase64Key(vector.keyBase64, 1);
    const sealed = { ciphertextBase64: sent.p_token_ciphertext, ivBase64: sent.p_token_iv, keyVersion: 1 };
    expect(await cipher.open(sealed, sent.p_connection)).toBe(LONG_TOKEN);
    expect(sent.p_ig_username).toBe("niijima_info");
  });

  it("NFR-001-03 記録に失敗したら理由をログに残すが、トークンはログに出さない", async () => {
    const failing = fakeServices({ recordFails: true });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logs.push(args.join(" ")); });
    const response = await callback("code=c&state=good", failing);
    spy.mockRestore();
    expect(response.headers.get("Location")).toBe("/settings/?instagram=error&reason=failed");
    expect(logs.join("\n")).toContain("500");
    expect(logs.join("\n")).not.toContain(LONG_TOKEN);
  });

  it("state が保存されていない・期限切れなら記録しない", async () => {
    expect((await callback("code=c&state=forged")).headers.get("Location")).toBe("/settings/?instagram=error&reason=state");
    expect(services.calls.some((c) => c.url.includes("record_instagram_connection"))).toBe(false);
    expect(services.calls.some((c) => c.url.includes("instagram.com"))).toBe(false);
    const expired = fakeServices({ stateExpired: true });
    expect((await callback("code=c&state=good", expired)).headers.get("Location")).toBe("/settings/?instagram=error&reason=state");
    expect(expired.calls.some((c) => c.url.includes("record_instagram_connection"))).toBe(false);
  });

  it("個人アカウントは連携しない", async () => {
    const personal = fakeServices({ accountType: "PERSONAL" });
    expect((await callback("code=c&state=good", personal)).headers.get("Location")).toBe("/settings/?instagram=error&reason=account_type");
  });

  it("Instagram で拒否されたら理由を返す", async () => {
    expect((await callback("error=access_denied&state=good")).headers.get("Location")).toBe("/settings/?instagram=error&reason=access_denied");
  });
});

describe("トークンの暗号化（fixtures/token-cipher.json。Java の TokenCipher と互換）", () => {
  it("NFR-001-03 共通テストベクタと同じ暗号文になり、復号できる", async () => {
    const cipher = await TokenCipher.fromBase64Key(vector.keyBase64, vector.keyVersion);
    const iv = Uint8Array.from(atob(vector.ivBase64), (c) => c.charCodeAt(0));
    const sealed = await cipher.seal(AccessToken.of(vector.plaintext), vector.connectionId, iv);
    expect(sealed.ciphertextBase64).toBe(vector.ciphertextBase64);
    expect(await cipher.open(sealed, vector.connectionId)).toBe(vector.plaintext);
    await expect(cipher.open(sealed, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  it("アクセストークンは文字列にしても値を出さない", () => {
    expect(`${AccessToken.of(LONG_TOKEN)}`).not.toContain(LONG_TOKEN);
    expect(JSON.stringify({ t: AccessToken.of(LONG_TOKEN) })).not.toContain(LONG_TOKEN);
  });
});
