import type { ImagePrompt } from "../../../src/domain/image/ImagePrompt";
import type { PromptTranslator } from "../application/imageGenerationPorts";

// 画像生成の指示を Gemini で英訳する（REQ-005 BR-005-10、02_外部連携設計 2.x）。キーは API関数の Secret（GEMINI_API_KEY）だけに置く
const INSTRUCTION = "Translate the following Japanese description of an image into one concise English prompt for a text-to-image model. "
  + "Keep every visual detail, add no new subjects, and output only the English prompt without quotes.";

export class GeminiTranslator implements PromptTranslator {
  constructor(private readonly apiKey: string, private readonly http: typeof fetch = (input, init) => fetch(input, init)) {}

  async toEnglish(prompt: ImagePrompt, model: string, timeoutMs: number): Promise<string> {
    const response = await this.http(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${INSTRUCTION}\n\n${prompt.text}` }] }] }),
    });
    if (!response.ok) throw new Error(`Gemini がエラーを返しました（${response.status}）`);
    const body = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    if (text === "") throw new Error("Gemini が英訳を返しませんでした");
    return text;
  }
}
