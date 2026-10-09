import { DraftProposal } from "../../../src/domain/draft/DraftProposal";
import type { PromptPurpose } from "../../../src/domain/draft/PromptPurpose";
import type { PostStyleSettings } from "../../../src/domain/post/PostStyleSettings";

// LLM（または手動コピペ）の出力を、下書き案の条件で検査する。違反の一覧は再生成と手動コピペの画面に渡す。
// 用途ごとの業務ルール（背景写真を選ぶのは PLAN だけ・修正で保つもの・枚数）は DraftProposal.parse と PromptPurpose が持つ

/** 修正の依頼の現在の下書きを読んだ結果（下書き案の形に整えたもの）と、修正で保つもの */
export type CurrentDraft = Extract<ReturnType<typeof DraftProposal.readCurrent>, { ok: true }>;

export type OutputRules = {
  style: PostStyleSettings;
  prLabel: string;
  purpose: PromptPurpose;
  /** PLAN で AI が選んでよい背景写真のID。0件なら紺の単色（選んだIDは捨てる） */
  backgroundPhotoIds: readonly string[];
  /** 修正（REVISE）のときだけ */
  keep?: CurrentDraft["keep"];
};

export type CheckedOutput = { proposal: DraftProposal | undefined; violations: string[] };

/** 貼り付けのコードブロック記号（```json … ```）を取り除いてから読む */
function parseJson(text: string): { value: unknown; error?: string } {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    return { value: JSON.parse(unfenced) };
  } catch (e) {
    return { value: undefined, error: `JSON として読めません（${e instanceof Error ? e.message : "不明なエラー"}）` };
  }
}

export function checkDraftOutput(text: string, rules: OutputRules): CheckedOutput {
  const parsed = parseJson(text);
  if (parsed.error) return { proposal: undefined, violations: [parsed.error] };
  return DraftProposal.parse(parsed.value, { settings: rules.style, prLabel: rules.prLabel, sourceUrlRequired: false,
    purpose: rules.purpose, backgroundPhotoIds: rules.backgroundPhotoIds, keep: rules.keep });
}

/** 修正の依頼の `current` を読む（形・大きさ・中のスライドの枚数・PR区分。文字数の違反は受け付ける） */
export const readCurrentDraft = (current: unknown) => DraftProposal.readCurrent(current);
