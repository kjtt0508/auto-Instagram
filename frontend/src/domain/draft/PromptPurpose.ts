import { PrCategory } from "../post/PrCategory";
import { AccentColor } from "../slide/AccentColor";
import { SlideList } from "../slide/SlideList";

const text = { type: "STRING" };
const textList = { type: "ARRAY", items: text };
const enumOf = (values: readonly string[]) => ({ type: "STRING", format: "enum", enum: [...values] });

/**
 * プロンプト用途: プロンプトの使い道（PLAN 企画生成／CAPTION キャプション生成／REVISE 修正指示による再生成）。
 * 出力の JSON スキーマ（Gemini の responseSchema）を返す。REQ-002 で使うのは PLAN と REVISE（CAPTION は REQ-003）
 */
export class PromptPurpose {
  static readonly PLAN = new PromptPurpose("PLAN", "企画生成");
  static readonly CAPTION = new PromptPurpose("CAPTION", "キャプション生成");
  static readonly REVISE = new PromptPurpose("REVISE", "修正指示による再生成");

  private constructor(
    readonly code: string,
    readonly label: string,
  ) {}

  static all(): readonly PromptPurpose[] {
    return [PromptPurpose.PLAN, PromptPurpose.CAPTION, PromptPurpose.REVISE];
  }

  static from(code: string): PromptPurpose {
    const found = PromptPurpose.all().find((p) => p.code === code);
    if (!found) throw new Error(`知らないプロンプト用途です: ${code}`);
    return found;
  }

  /** 背景写真の候補から AI に選ばせるのは、最初の生成（PLAN）だけ。修正では背景写真を変えない */
  choosesBackgroundPhoto(): boolean {
    return this === PromptPurpose.PLAN;
  }

  /** 現在の下書きを直す用途か。直すときは PR区分・参照元URL・中のスライドの枚数を現在のまま保つ（修正指示は文言だけを変える） */
  keepsCurrentDraftTraits(): boolean {
    return this === PromptPurpose.REVISE;
  }

  /** 手動コピペで取り込める用途（キャプション生成は REQ-003 で扱うので、いまは取り込めない） */
  acceptsManualImport(): boolean {
    return this === PromptPurpose.PLAN || this === PromptPurpose.REVISE;
  }

  /**
   * 下書き案の出力 JSON スキーマ（形は draftJson.ts の読み方と同じ）。
   * PLAN は中のスライド 1〜8枚。REVISE は中のスライドの枚数を bodySlideCount に固定する
   */
  outputSchema(options: { bodySlideCount?: number } = {}): Record<string, unknown> {
    const slides = this.slideCountRange(options.bodySlideCount);
    return {
      type: "OBJECT",
      properties: {
        cover: {
          type: "OBJECT",
          properties: { target: text, keyword: text, annotation: text, closingWords: text, accent: enumOf(AccentColor.all().map((c) => c.code)) },
          required: ["target", "keyword", "annotation", "closingWords", "accent"],
        },
        backgroundPhotoId: text,
        slides: {
          type: "ARRAY", minItems: slides.min, maxItems: slides.max,
          items: {
            type: "OBJECT",
            properties: { heading: text, description: text, emphases: textList, picturePrompt: text, needsReplacement: { type: "BOOLEAN" } },
            required: ["heading", "description", "emphases", "picturePrompt", "needsReplacement"],
          },
        },
        caption: text,
        additionalHashtags: textList,
        prCategory: enumOf(PrCategory.all().map((c) => c.code)),
        sourceUrls: textList,
      },
      required: ["cover", "slides", "caption", "additionalHashtags", "prCategory", "sourceUrls"],
    };
  }

  private slideCountRange(bodySlideCount: number | undefined): { min: number; max: number } {
    if (this === PromptPurpose.CAPTION) throw new Error("キャプション生成の出力スキーマは REQ-003 で定めます");
    if (this === PromptPurpose.PLAN) return { min: SlideList.BODY_MIN, max: SlideList.BODY_MAX };
    if (bodySlideCount === undefined || !Number.isInteger(bodySlideCount)
      || bodySlideCount < SlideList.BODY_MIN || bodySlideCount > SlideList.BODY_MAX) {
      throw new Error(`修正の出力スキーマには中のスライドの枚数（${SlideList.BODY_MIN}〜${SlideList.BODY_MAX}）が要ります`);
    }
    return { min: bodySlideCount, max: bodySlideCount };
  }
}
