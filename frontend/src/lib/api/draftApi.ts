import { LlmQuota } from "@/domain/draft/LlmQuota";
import { LlmUsage } from "@/domain/draft/LlmUsage";
import type { PrCategory } from "@/domain/post/PrCategory";
import type { SlideList } from "@/domain/slide/SlideList";
import { supabase } from "./supabase";

// 下書き案の生成・修正・手動コピペ（API関数。REQ-002 設計 4章）。鍵はブラウザに出さない。回数の見せ方の判断は LlmUsage

/** API が返す下書き案（DraftProposal.toJson と同じ形）。画面は DraftProposal.parse で下書き案に戻す */
export type DraftResponse = {
  generationId: string; ideaId: string; proposal: unknown; unsupportedFacts: { location: string; fact: string }[];
  /** 手動コピペの取り込みは null（回数を使わない） */
  usage: LlmUsage | null; parentGenerationId?: string;
};

/** API が拒んだ理由。ideaId があるのは、ネタが記録されていて手動コピペで続けられるとき（上限・障害・出力の不備） */
export class DraftApiError extends Error {
  constructor(message: string, readonly code: string, readonly details: string[], readonly ideaId: string | undefined) {
    super(message);
  }

  canContinueManually(): boolean {
    return this.ideaId !== undefined;
  }
}

type UsageBody = { used: number; dailyLimit: number; warnRatio: number } | null;
type ResponseBody = Omit<DraftResponse, "usage"> & { usage: UsageBody };

async function callApi<T>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const response = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = json?.error;
    throw new DraftApiError(error?.message ?? "処理に失敗しました。時間を置いてお試しください", error?.code ?? "INTERNAL",
      Array.isArray(error?.details) ? error.details : [], error?.ideaId);
  }
  return json as T;
}

const toResponse = (body: ResponseBody): DraftResponse => ({
  ...body,
  usage: body.usage ? LlmUsage.reserved(body.usage.used, LlmQuota.of(body.usage.dailyLimit, body.usage.warnRatio)) : null,
});

/** ネタから下書き案を作る（〜30秒。60秒で打ち切り） */
export async function generateDraft(ideaText: string): Promise<DraftResponse> {
  return toResponse(await callApi<ResponseBody>("/api/drafts", { ideaText }));
}

/** 修正指示で文言を作り直す。current は今の画面の内容（currentDraftJson） */
export async function reviseDraft(generationId: string, instruction: string, current: unknown): Promise<DraftResponse> {
  return toResponse(await callApi<ResponseBody>(`/api/drafts/${encodeURIComponent(generationId)}/revise`, { instruction, current }));
}

/** 手動コピペ用のプロンプトを得る。ideaId があればそのネタで、無ければネタを記録する。修正のときは instruction と current を添える */
export function manualPrompt(request: { ideaId?: string; ideaText?: string; instruction?: string; current?: unknown }):
  Promise<{ ideaId: string; promptVersionId: string; prompt: string }> {
  return callApi("/api/drafts/manual-prompt", request);
}

/** 貼り付けた JSON を取り込む。修正のプロンプトを使ったときは parentGenerationId・instruction・current も送る */
export async function importManual(request: {
  ideaId: string; promptVersionId: string; json: string;
  revision?: { parentGenerationId: string; instruction: string; current: unknown };
}): Promise<DraftResponse> {
  const { revision, ...rest } = request;
  return toResponse(await callApi<ResponseBody>("/api/drafts/manual", { ...rest, ...revision }));
}

/** 今の画面の内容を、下書き案と同じ形の JSON にする（修正指示・手動コピペの current）。背景写真は修正で変わらないので含めない */
export function currentDraftJson(work: {
  slides: SlideList; captionText: string; additionalHashtags: readonly string[]; prCategory: PrCategory; sourceUrls: readonly string[];
}) {
  const [first, ...rest] = work.slides.items();
  const cover = first.coverContent()!.text;
  return {
    cover: { target: cover.target, keyword: cover.keyword, annotation: cover.annotation, closingWords: cover.closingWords, accent: cover.accent.code },
    slides: rest.flatMap((s) => s.bodyContent() ?? []).map((b) => ({
      heading: b.text.heading, description: b.text.description, emphases: [...b.text.emphases],
      picturePrompt: b.brief.promptText(), needsReplacement: b.brief.needsReplacement(),
    })),
    caption: work.captionText, additionalHashtags: [...work.additionalHashtags], prCategory: work.prCategory.code, sourceUrls: [...work.sourceUrls],
  };
}
