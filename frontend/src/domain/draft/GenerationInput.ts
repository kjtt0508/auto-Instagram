import { FixedHashtags } from "../post/FixedHashtags";
import { AccentColor } from "../slide/AccentColor";
import { CoverText } from "../slide/CoverText";
import { SlideList } from "../slide/SlideList";
import { SlideText } from "../slide/SlideText";
import { Idea } from "./Idea";
import type { RevisionInstruction } from "./RevisionInstruction";

/**
 * 生成の入力: LLM に渡してよい項目だけを持つ入力（ネタの本文・今日の日付・表紙の対象の候補・背景写真の候補（IDと説明文）・
 * アクセント色の候補・修正指示と現在の文言・修正で保つ中のスライドの枚数）。
 * 入稿者連絡先などの個人情報の欄を持たない（この型に欄が無いことで保証する。REQ-002 BR-002-08, AC-002-09）。
 * プロンプト版に差し込む値を返す。記録（generations.input）には toJson() をそのまま使う
 */
export class GenerationInput {
  private constructor(
    private readonly ideaText: string,
    private readonly today: string,
    private readonly coverTargets: readonly string[],
    private readonly backgroundPhotos: readonly { id: string; description: string }[] | undefined,
    private readonly revision: { instruction: RevisionInstruction; currentDraft: Record<string, unknown>; bodySlideCount: number } | undefined,
  ) {
    if (Idea.violationsOf(ideaText).length > 0) throw new Error("ネタの本文が条件を満たしていません");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(today)) throw new Error(`今日の日付は YYYY-MM-DD で指定してください: ${today}`);
  }

  /** 最初の生成（PLAN）の入力。背景写真の候補は 0枚でもよい */
  static forPlan(parts: {
    ideaText: string; today: string; coverTargets: readonly string[]; backgroundPhotos: readonly { id: string; description: string }[];
  }): GenerationInput {
    return new GenerationInput(parts.ideaText, parts.today, parts.coverTargets, [...parts.backgroundPhotos], undefined);
  }

  /** 修正指示による再生成（REVISE）の入力。中のスライドの枚数は現在の下書きの枚数で固定する */
  static forRevision(parts: {
    ideaText: string; today: string; coverTargets: readonly string[]; instruction: RevisionInstruction;
    currentDraft: Record<string, unknown>; bodySlideCount: number;
  }): GenerationInput {
    if (parts.bodySlideCount < SlideList.BODY_MIN || parts.bodySlideCount > SlideList.BODY_MAX) {
      throw new Error(`中のスライドは${SlideList.BODY_MIN}〜${SlideList.BODY_MAX}枚です（${parts.bodySlideCount}枚）`);
    }
    return new GenerationInput(parts.ideaText, parts.today, parts.coverTargets, undefined,
      { instruction: parts.instruction, currentDraft: parts.currentDraft, bodySlideCount: parts.bodySlideCount });
  }

  /** 文字数・枚数・個数の上限の言い方（値はドメインの定数から作る。プロンプトの本文には数値を書かない） */
  static limitsText(): string {
    return [
      `キーワード${CoverText.KEYWORD_MAX}文字`, `添え書き${CoverText.ANNOTATION_MAX}文字`, `締めの言葉${CoverText.CLOSING_WORDS_MAX}文字`,
      `見出し${SlideText.HEADING_MAX}文字`, `説明文${SlideText.DESCRIPTION_MAX}文字`, `強調する語${SlideText.EMPHASES_MAX}か所まで`,
      `中のスライド${SlideList.BODY_MIN}〜${SlideList.BODY_MAX}枚`, `追加のハッシュタグ${FixedHashtags.ADDITIONAL_MAX}個まで`,
    ].join("、");
  }

  /** 中のスライドの枚数を固定する修正か */
  bodySlideCount(): number | undefined {
    return this.revision?.bodySlideCount;
  }

  /** プロンプト版の `{{名前}}` に差し込む値（REQ-002 設計 4章の表。用途に無い値は含めない） */
  placeholders(): Record<string, string> {
    const common = {
      today: this.today,
      ideaText: this.ideaText,
      coverTargets: this.coverTargets.join("、"),
      accentColors: AccentColor.all().map((c) => `${c.code}（${c.label}）`).join("、"),
      limits: GenerationInput.limitsText(),
    };
    if (this.revision) {
      return { ...common, currentDraft: JSON.stringify(this.revision.currentDraft, null, 2), instruction: this.revision.instruction.text,
        bodySlideCount: String(this.revision.bodySlideCount) };
    }
    const photos = this.backgroundPhotos ?? [];
    return { ...common, backgroundPhotos: photos.length === 0 ? "なし" : photos.map((p) => `${p.id}: ${p.description}`).join("\n") };
  }

  /** 記録とシリアライズ用。LLM に渡す項目だけで、個人情報の欄は無い */
  toJson(): Record<string, unknown> {
    return {
      ideaText: this.ideaText, today: this.today, coverTargets: [...this.coverTargets],
      accentColors: AccentColor.all().map((c) => ({ code: c.code, label: c.label })),
      ...(this.backgroundPhotos ? { backgroundPhotos: this.backgroundPhotos.map((p) => ({ id: p.id, description: p.description })) } : {}),
      ...(this.revision ? { revision: { instruction: this.revision.instruction.text, currentDraft: this.revision.currentDraft,
        bodySlideCount: this.revision.bodySlideCount } } : {}),
    };
  }
}
