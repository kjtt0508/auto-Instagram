import { DraftProposal } from "../../../src/domain/draft/DraftProposal";
import { readDraftJson } from "../../../src/domain/draft/draftJson";
import { SlideList } from "../../../src/domain/slide/SlideList";
import { SlideRole } from "../../../src/domain/slide/SlideRole";
import { PrCategory } from "../../../src/domain/post/PrCategory";
import type { PostStyleSettings } from "../../../src/domain/post/PostStyleSettings";

// LLM（または手動コピペ）の出力を、下書き案の条件で検査する。違反の一覧は再生成と手動コピペの画面に渡す

/** 修正（REVISE）のとき守るもの: 中のスライドの枚数・PR区分・参照元URL（背景写真は修正で変えない） */
export type RevisionKeep = { bodySlideCount: number; prCategory: string; sourceUrls: string[] };

export type OutputRules = {
  style: PostStyleSettings;
  prLabel: string;
  /** 最初の生成（PLAN）で AI が選んでよい背景写真のID。0件なら紺の単色（選んだIDは捨てる） */
  backgroundPhotoIds: readonly string[];
  /** 修正のときだけ */
  revision?: RevisionKeep;
};

export type CheckedOutput = { proposal: DraftProposal | undefined; violations: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  const raw = isRecord(parsed.value) ? parsed.value : undefined;
  const value = raw ? adjusted(raw, rules) : parsed.value;
  const result = DraftProposal.parse(value, { settings: rules.style, prLabel: rules.prLabel, sourceUrlRequired: false });
  const violations = [...result.violations, ...(raw ? extraViolations(raw, rules) : [])];
  return { proposal: violations.length === 0 ? result.proposal : undefined, violations };
}

/** 修正では背景写真・PR区分・参照元URLを保つ。候補が 0枚のときは背景写真を選ばない */
function adjusted(raw: Record<string, unknown>, rules: OutputRules): Record<string, unknown> {
  if (rules.revision) {
    return { ...raw, backgroundPhotoId: undefined, prCategory: rules.revision.prCategory, sourceUrls: rules.revision.sourceUrls };
  }
  return rules.backgroundPhotoIds.length === 0 ? { ...raw, backgroundPhotoId: undefined } : raw;
}

function extraViolations(raw: Record<string, unknown>, rules: OutputRules): string[] {
  if (rules.revision) {
    const count = Array.isArray(raw.slides) ? raw.slides.length : undefined;
    return count !== undefined && count !== rules.revision.bodySlideCount
      ? [`中のスライドは${rules.revision.bodySlideCount}枚にしてください（${count}枚）`] : [];
  }
  const chosen = raw.backgroundPhotoId;
  return rules.backgroundPhotoIds.length > 0 && typeof chosen === "string" && chosen !== "" && !rules.backgroundPhotoIds.includes(chosen)
    ? [`背景写真のIDが候補にありません: ${chosen}`] : [];
}

/** 修正の依頼の `current`（下書き案と同じ形）を読む。形が違う・中のスライドの枚数が範囲外なら理由の一覧 */
export function readCurrentDraft(current: unknown):
  { ok: true; draft: Record<string, unknown>; keep: RevisionKeep } | { ok: false; errors: string[] } {
  if (!isRecord(current)) return { ok: false, errors: ["current は下書き案と同じ形のオブジェクトで指定してください"] };
  const { errors, value } = readDraftJson(current);
  const bodyCount = value.slides.length;
  const rangeErrors = SlideList.violationsOf([SlideRole.COVER, ...Array.from({ length: bodyCount }, () => SlideRole.BODY), SlideRole.CLOSING]);
  const prErrors = PrCategory.all().some((c) => c.code === value.prCategoryCode) ? [] : ["prCategory は NONE か PR で指定してください"];
  if (errors.length + rangeErrors.length + prErrors.length > 0) return { ok: false, errors: [...errors, ...rangeErrors, ...prErrors] };
  return { ok: true, draft: current, keep: { bodySlideCount: bodyCount, prCategory: value.prCategoryCode, sourceUrls: value.sourceUrls } };
}
