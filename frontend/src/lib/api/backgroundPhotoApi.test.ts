import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptGeneratedBackground, BackgroundPhotoApiError } from "./backgroundPhotoApi";

// 生成した背景を背景写真にする API関数の呼び出し（REQ-006 設計 4章）。Supabase のセッションと fetch は代役にする

vi.mock("./supabase", () => ({
  supabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token-1" } } }) } }),
}));

const REQUEST = { generationId: "g-1", candidatePosition: 2, description: "夕暮れの京都御苑" };
const ADOPTED = { photoId: "p-1", storagePath: "t1/backgrounds/p-1.jpg", description: "夕暮れの京都御苑" };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

describe("AC-006-04 AC-006-09 adoptGeneratedBackground", () => {
  it("API関数に1回だけ、Bearer つきで { generationId, candidatePosition, description } を送り、背景写真の ID・保存先・説明文を返す", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, ADOPTED));

    await expect(adoptGeneratedBackground(REQUEST)).resolves.toEqual(ADOPTED);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/background-photos");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST);
  });

  it("AC-006-10 同じ候補がすでに背景写真になっていた（200）ときも、同じ形で返す", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, ADOPTED));
    await expect(adoptGeneratedBackground(REQUEST)).resolves.toEqual(ADOPTED);
  });

  it("画面が画像を取得・変換・アップロードしない: 呼ぶのは API関数への fetch 1回だけ", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, ADOPTED));
    await adoptGeneratedBackground(REQUEST);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/background-photos"]);
  });
});

describe("AC-006-07 AC-006-10 adoptGeneratedBackground のエラー", () => {
  const rejects = async (status: number, error: unknown) => {
    fetchMock.mockResolvedValueOnce(reply(status, { error }));
    return adoptGeneratedBackground(REQUEST).then(() => null, (e: unknown) => e);
  };

  it("サーバーのエラーコードと文言を持つエラーを投げる（409 BACKGROUND_LIMIT_REACHED）", async () => {
    const e = await rejects(409, { code: "BACKGROUND_LIMIT_REACHED", message: "背景写真が30枚です", details: [] });
    expect(e).toBeInstanceOf(BackgroundPhotoApiError);
    expect(e).toMatchObject({ code: "BACKGROUND_LIMIT_REACHED", message: "背景写真が30枚です" });
  });

  it.each(["CANDIDATE_GONE", "NOT_ADOPTABLE", "INVALID_REQUEST", "FORBIDDEN", "NOT_FOUND", "STORAGE_FAILED"])("%s もコードを保つ", async (code) => {
    const e = await rejects(409, { code, message: "理由", details: [] });
    expect(e).toMatchObject({ code, message: "理由" });
  });

  it("エラーの本文が読めないときは、コード INTERNAL と既定の文言", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }));
    const e = await adoptGeneratedBackground(REQUEST).then(() => null, (error: unknown) => error);
    expect(e).toMatchObject({ code: "INTERNAL", message: "背景を登録できませんでした。時間を置いてお試しください" });
  });

  it("成功の応答の形が違うときは失敗にする（背景を変えない）", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { photoId: "p-1" }));
    await expect(adoptGeneratedBackground(REQUEST)).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("通信できないときは、コード NETWORK の失敗にする", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(adoptGeneratedBackground(REQUEST)).rejects.toMatchObject({ code: "NETWORK" });
  });
});
