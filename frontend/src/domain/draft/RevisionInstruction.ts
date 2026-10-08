import { lengthViolations } from "../slide/lengthViolations";

/** 修正指示: 承認者・編集者が自然文で出す直してほしい点（例「もっとくだけた感じで」）。1〜500文字（コードポイントで数える） */
export class RevisionInstruction {
  static readonly MAX_LENGTH = 500;

  private constructor(readonly text: string) {}

  /** 満たさない条件（空なら受け付けられる）。空白だけの指示は空として扱う */
  static violationsOf(text: string): string[] {
    return lengthViolations("修正指示", text.trim() === "" ? "" : text, 1, RevisionInstruction.MAX_LENGTH);
  }

  static of(text: string): RevisionInstruction {
    const violations = RevisionInstruction.violationsOf(text);
    if (violations.length > 0) throw new Error(violations.join("\n"));
    return new RevisionInstruction(text);
  }
}
