import { LlmCallFailure, type DraftModelClient } from "../application/draftPorts";

// 下書き案を Gemini で生成する（REQ-002 設計 4章）。responseMimeType=application/json と responseSchema を渡す。
// キーは API関数の Secret（GEMINI_API_KEY）だけに置き、ヘッダーで渡す（URL・ログ・応答に出さない）。例外の文言は状態コードだけにする
export class GeminiDraftClient implements DraftModelClient {
  constructor(private readonly apiKey: string, private readonly http: typeof fetch = (input, init) => fetch(input, init)) {}

  async generate(request: { model: string; prompt: string; schema: Record<string, unknown>; timeoutMs: number }): Promise<string> {
    try {
      const response = await this.http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`, {
        method: "POST",
        signal: AbortSignal.timeout(request.timeoutMs),   // 依頼全体（本文を読み終えるまで）の残り時間で打ち切る
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: request.schema },
        }),
      });
      if (!response.ok) throw new LlmCallFailure("UNAVAILABLE", `Gemini がエラーを返しました（${response.status}）`);
      const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    } catch (e) {
      if (e instanceof LlmCallFailure) throw e;
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new LlmCallFailure("TIMEOUT", "Gemini が時間内に応答しませんでした");
      throw new LlmCallFailure("UNAVAILABLE", "Gemini に接続できませんでした");
    }
  }
}
