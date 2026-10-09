import { describe, expect, it } from "vitest";
import { GenerationInput } from "./GenerationInput";
import { PromptPurpose } from "./PromptPurpose";
import { RevisionInstruction } from "./RevisionInstruction";

const bodyOf = (names: readonly string[]) => names.map((n) => `{{${n}}}`).join("\n");

describe("プロンプトの本文の条件（AC-002-08）", () => {
  it("AC-002-08 差し込み値の名前は、生成の入力が作る値の名前と同じ", () => {
    const plan = GenerationInput.forPlan({ ideaText: "・学割", today: "2026-10-05", coverTargets: ["同志社大学"], backgroundPhotos: [] });
    const revision = GenerationInput.forRevision({
      ideaText: "・学割", today: "2026-10-05", coverTargets: ["同志社大学"], instruction: RevisionInstruction.of("くだけて"),
      currentDraft: {}, bodySlideCount: 2,
    });
    expect([...PromptPurpose.PLAN.placeholderNames()!].sort()).toEqual(Object.keys(plan.placeholders()).sort());
    expect([...PromptPurpose.REVISE.placeholderNames()!].sort()).toEqual(Object.keys(revision.placeholders()).sort());
  });

  it("AC-002-08 必要な差し込み値がそろっていれば違反は無い", () => {
    expect(PromptPurpose.PLAN.violationsOfBody(bodyOf(PromptPurpose.PLAN.placeholderNames()!))).toEqual([]);
    expect(PromptPurpose.REVISE.violationsOfBody(bodyOf(PromptPurpose.REVISE.placeholderNames()!))).toEqual([]);
  });

  it("AC-002-08 足りない差し込み値は名前を挙げて示す", () => {
    const body = bodyOf(PromptPurpose.PLAN.placeholderNames()!.filter((n) => n !== "limits" && n !== "today"));
    expect(PromptPurpose.PLAN.violationsOfBody(body)).toEqual(["プロンプトの本文に必要な差し込み値がありません: {{today}}、{{limits}}"]);
  });

  it("AC-002-08 その用途に無い差し込み値（PLAN に {{instruction}}）や、知らない差し込み値は拒む", () => {
    const body = `${bodyOf(PromptPurpose.PLAN.placeholderNames()!)}{{instruction}}{{unknownName}}`;
    expect(PromptPurpose.PLAN.violationsOfBody(body)).toEqual(["プロンプトの本文に知らない差し込み値があります: {{instruction}}、{{unknownName}}"]);
  });

  it("AC-002-08 本文が空（空白だけ）なら入力を求める", () => {
    expect(PromptPurpose.PLAN.violationsOfBody("  \n")).toEqual(["プロンプトの本文を入力してください"]);
  });
});
