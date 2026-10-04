import type { PostStyleSettings } from "../post/PostStyleSettings";
import { AccentColor } from "./AccentColor";
import { lengthViolations } from "./lengthViolations";

/**
 * 表紙の文言: 表紙の3段に描く文言。対象・キーワード（1〜10文字）・添え書き（0〜16文字）・締めの言葉（1〜8文字）と、帯のアクセント色。
 * 対象は投稿の型の設定の「表紙の対象の候補」のどれか（REQ-002 BR-002-12）。AI の出力にも人の書き換えにも同じ検査をかける。
 * Java の CoverText と揃える（docs/model/fixtures/slide-text.json）
 */
export class CoverText {
  static readonly KEYWORD_MAX = 10;
  static readonly ANNOTATION_MAX = 16;
  static readonly CLOSING_WORDS_MAX = 8;

  private constructor(
    readonly target: string,
    readonly keyword: string,
    readonly annotation: string,
    readonly closingWords: string,
    readonly accent: AccentColor,
  ) {}

  /** 満たさない条件（空なら受け付けられる）。アクセント色は区分のコードで受ける（AI の出力は文字列のため） */
  static violationsOf(parts: Parameters<typeof CoverText.restore>[0], settings: PostStyleSettings): string[] {
    return [
      ...(settings.acceptsCoverTarget(parts.target) ? [] : [CoverText.targetViolation(settings)]),
      ...lengthViolations("キーワード", parts.keyword, 1, CoverText.KEYWORD_MAX),
      ...lengthViolations("添え書き", parts.annotation, 0, CoverText.ANNOTATION_MAX),
      ...lengthViolations("締めの言葉", parts.closingWords, 1, CoverText.CLOSING_WORDS_MAX),
      ...(AccentColor.all().some((c) => c.code === parts.accentCode) ? [] : [CoverText.accentViolation()]),
    ];
  }

  /** 検査して作る。満たさなければ例外（人の入力を保存するとき） */
  static of(parts: Parameters<typeof CoverText.restore>[0], settings: PostStyleSettings): CoverText {
    const violations = CoverText.violationsOf(parts, settings);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return CoverText.restore(parts);
  }

  /** 記録から戻すときは検査しない（設定の候補が後で変わっても、過去の版を復元できる） */
  static restore(parts: {
    readonly target: string; readonly keyword: string; readonly annotation: string;
    readonly closingWords: string; readonly accentCode: string;
  }): CoverText {
    return new CoverText(parts.target, parts.keyword, parts.annotation, parts.closingWords, AccentColor.from(parts.accentCode));
  }

  private static targetViolation(settings: PostStyleSettings): string {
    return `対象は${settings.coverTargets().map((t) => `「${t}」`).join("")}のどれかにしてください`;
  }

  private static accentViolation(): string {
    return `帯の色は${AccentColor.all().map((c) => c.label).join("・")}のどれかにしてください`;
  }
}
