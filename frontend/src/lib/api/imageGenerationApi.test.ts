import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagePrompt } from "@/domain/image/ImagePrompt";
import { ImageStyle } from "@/domain/post/ImageStyle";
import { generateCandidates, ImageGenerationError } from "./imageGenerationApi";

// 画像生成の API関数の呼び出し。サーバーのエラーコードを持つエラーを投げる（用途ごとの案内への読み替えのため。REQ-006 設計 3章）

vi.mock("./supabase", () => ({
  supabase: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "token-1" } } }) } }),
  unwrap: (result: { data: unknown }) => result.data,
}));

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { fetchMock.mockReset(); vi.unstubAllGlobals(); });

describe("AC-006-08 generateCandidates のエラー", () => {
  const prompt = ImagePrompt.of("夕暮れの京都御苑、やわらかい光");
  const failure = (status: number, code: string, message: string) => {
    fetchMock.mockResolvedValueOnce(reply(status, { error: { code, message, details: [] } }));
    return generateCandidates(ImageStyle.ILLUSTRATION, prompt).then(() => null, (e: unknown) => e);
  };

  it("上限（409 IMAGE_LIMIT_REACHED）は、サーバーのコードと文言を持つエラーになる（文言はこれまでどおり）", async () => {
    const e = await failure(409, "IMAGE_LIMIT_REACHED", "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください");
    expect(e).toBeInstanceOf(ImageGenerationError);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ code: "IMAGE_LIMIT_REACHED", message: "今日の画像生成は上限に達しました。写真を撮る・選ぶで続けてください" });
  });

  it.each([
    [503, "TRANSLATION_UNAVAILABLE"], [502, "GENERATION_FAILED"], [504, "GENERATION_TIMEOUT"], [400, "INVALID_PROMPT"],
  ])("%i %s もコードを保つ", async (status, code) => {
    expect(await failure(status, code, "理由")).toMatchObject({ code, message: "理由" });
  });

  it("エラーの本文が読めないときは、コード INTERNAL と既定の文言", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const e = await generateCandidates(ImageStyle.ILLUSTRATION, prompt).then(() => null, (error: unknown) => error);
    expect(e).toMatchObject({ code: "INTERNAL", message: "画像を生成できませんでした" });
  });

  it("成功すると候補と今日の回数を返す（背景の生成は画像の種類 ILLUSTRATION を送る）", async () => {
    fetchMock.mockResolvedValueOnce(reply(201, {
      generationId: "g-1", candidates: [{ position: 1, url: "https://example.test/1.png" }], usage: { used: 1, dailyLimit: 20, warnRatio: 0.8 },
    }));
    const result = await generateCandidates(ImageStyle.ILLUSTRATION, prompt);
    expect(result.generationId).toBe("g-1");
    expect(result.usage.remaining()).toBe(19);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ style: "ILLUSTRATION", prompt: "夕暮れの京都御苑、やわらかい光" });
  });
});
