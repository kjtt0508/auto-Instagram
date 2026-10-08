import { describe, expect, it } from "vitest";
import { GenerationRetryPolicy } from "./GenerationRetryPolicy";
import { GenerationRoute } from "./GenerationRoute";
import { Idea } from "./Idea";
import { LlmQuota } from "./LlmQuota";
import { LlmUsage } from "./LlmUsage";
import { RevisionInstruction } from "./RevisionInstruction";

describe("LLM利用回数の警告", () => {
  const warns = (usedBefore: number) => LlmUsage.reserved(usedBefore + 1, LlmQuota.of(100, 0.8)).shouldWarn();

  it.each([[79, false], [80, true], [99, true]])("AC-002-06 上限100・割合0.8で %i 回使用済みなら警告は %s", (usedBefore, expected) => {
    expect(warns(usedBefore)).toBe(expected);
  });

  it("上限は1以上、割合は0より大きく1以下", () => {
    expect(() => LlmQuota.of(0, 0.8)).toThrow();
    expect(() => LlmQuota.of(100, 0)).toThrow();
    expect(() => LlmQuota.of(100, 1.1)).toThrow();
  });
});

describe("再生成方針", () => {
  it("AC-002-04 違反があり、まだ作り直していなければ作り直してよい。作り直しは1回まで", () => {
    expect(GenerationRetryPolicy.canRetry(["キーワードは1〜12文字にしてください（13文字）"], 0)).toBe(true);
    expect(GenerationRetryPolicy.canRetry(["x"], 1)).toBe(false);
    expect(GenerationRetryPolicy.canRetry([], 0)).toBe(false);
  });

  it("作り直しのときの説明は、違反を1行ずつ並べる", () => {
    const note = GenerationRetryPolicy.correctionNote(["違反A", "違反B"]);
    expect(note).toContain("- 違反A\n- 違反B");
  });
});

describe("修正指示・ネタ・生成経路", () => {
  it("修正指示は1〜500文字", () => {
    expect(RevisionInstruction.violationsOf("あ".repeat(500))).toEqual([]);
    expect(RevisionInstruction.violationsOf("あ".repeat(501))).toEqual(["修正指示は1〜500文字にしてください（501文字）"]);
    expect(RevisionInstruction.violationsOf("  ")).toEqual(["修正指示は1〜500文字にしてください（0文字）"]);
  });

  it("ネタの本文は1〜2,000文字（絵文字は1文字）", () => {
    expect(Idea.violationsOf("😀".repeat(2000))).toEqual([]);
    expect(Idea.violationsOf("あ".repeat(2001))).toEqual(["ネタは1〜2000文字にしてください（2001文字）"]);
    expect(Idea.violationsOf("")).toHaveLength(1);
    expect(() => Idea.memo({ id: "i1", text: "" })).toThrow();
  });

  it("AC-002-07 LLM利用回数を数えるのは API のみ（手動コピペは数えない）", () => {
    expect(GenerationRoute.API.countsLlmUsage()).toBe(true);
    expect(GenerationRoute.MANUAL.countsLlmUsage()).toBe(false);
  });
});
