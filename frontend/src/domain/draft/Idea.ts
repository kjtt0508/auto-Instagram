import { lengthViolations } from "../slide/lengthViolations";

/**
 * ネタ: 投稿の元になる情報。REQ-002 で作るのは運営メモ（MEMO）だけ（大学ニュース・PR入稿は REQ-003 で広げる）。
 * 本文は1〜2,000文字（コードポイントで数える）
 */
export class Idea {
  static readonly TEXT_MAX = 2000;

  private constructor(readonly id: string, readonly text: string) {}

  /** 本文が満たさない条件（空なら受け付けられる）。空白だけの本文は空として扱う */
  static violationsOf(text: string): string[] {
    return lengthViolations("ネタ", text.trim() === "" ? "" : text, 1, Idea.TEXT_MAX);
  }

  /** 運営メモのネタを作る。本文が条件を満たさなければ例外 */
  static memo(parts: { id: string; text: string }): Idea {
    const violations = Idea.violationsOf(parts.text);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new Idea(parts.id, parts.text);
  }
}
