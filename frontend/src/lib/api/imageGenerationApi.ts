import { ImageGenerationQuota } from "@/domain/image/ImageGenerationQuota";
import { ImageGenerationUsage } from "@/domain/image/ImageGenerationUsage";
import type { ImagePrompt } from "@/domain/image/ImagePrompt";
import type { ImageStyle } from "@/domain/post/ImageStyle";
import { supabase, unwrap } from "./supabase";

// 画像生成（REQ-005 設計 4章）。API関数を呼ぶ（鍵はブラウザに出さない）。回数の判断は ImageGenerationUsage

export type GeneratedCandidates = { generationId: string; candidates: { position: number; url: string }[]; usage: ImageGenerationUsage };

const NO_CONTENT = 204;

type UsageBody ={ used: number; dailyLimit: number; warnRatio: number };

async function callApi<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === NO_CONTENT) return undefined as T;
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "画像を生成できませんでした");
  return json as T;
}

const toUsage = (u: UsageBody) => ImageGenerationUsage.of(u.used, ImageGenerationQuota.of(u.dailyLimit, u.warnRatio));

/** 候補を作る（〜30秒）。上限・英訳できない・失敗のときは、画面に出す文言の Error */
export async function generateCandidates(style: ImageStyle, prompt: ImagePrompt): Promise<GeneratedCandidates> {
  const result = await callApi<{ generationId: string; candidates: { position: number; url: string }[]; usage: UsageBody }>(
    "/api/image-generations", { style: style.code, prompt: prompt.text });
  return { ...result, usage: toUsage(result.usage) };
}

/** 候補を片付ける（採用の操作を終えた・閉じた）。失敗しても daily が消すので、画面には出さない */
export async function clearCandidates(generationId: string): Promise<void> {
  await callApi<void>(`/api/image-generations/${encodeURIComponent(generationId)}/clear`).catch(() => undefined);
}

/** 今日の画像生成の回数 */
export async function imageGenerationUsage(): Promise<ImageGenerationUsage> {
  const rows = unwrap(await supabase().rpc("image_generation_usage")) as { used: number; daily_limit: number; warn_ratio: number }[];
  const row = rows[0] ?? { used: 0, daily_limit: 1, warn_ratio: 1 };
  return toUsage({ used: row.used, dailyLimit: row.daily_limit, warnRatio: Number(row.warn_ratio) });
}
