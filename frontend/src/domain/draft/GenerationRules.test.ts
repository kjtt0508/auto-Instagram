import { describe, expect, it } from "vitest";
import { GenerationRetryPolicy } from "./GenerationRetryPolicy";
import { GenerationRoute } from "./GenerationRoute";
import { Idea } from "./Idea";
import { LlmQuota } from "./LlmQuota";
import { LlmUsage } from "./LlmUsage";
import { PromptPurpose } from "./PromptPurpose";
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
    const enough = GenerationRetryPolicy.MIN_RETRY_REMAINING_MS;
    expect(GenerationRetryPolicy.canRetry(["キーワードは1〜12文字にしてください（13文字）"], 0, enough)).toBe(true);
    expect(GenerationRetryPolicy.canRetry(["x"], 1, enough)).toBe(false);
    expect(GenerationRetryPolicy.canRetry([], 0, enough)).toBe(false);
  });

  it("AC-002-04 作り直しは残り20秒以上のときだけ（19,999ms は不可、20,000ms は可）", () => {
    expect(GenerationRetryPolicy.canRetry(["x"], 0, 19_999)).toBe(false);
    expect(GenerationRetryPolicy.canRetry(["x"], 0, 20_000)).toBe(true);
  });

  it("AC-002-04 制限時間は60秒。残り時間は負にならない", () => {
    expect(GenerationRetryPolicy.remainingMs(0)).toBe(60_000);
    expect(GenerationRetryPolicy.remainingMs(40_000)).toBe(20_000);
    expect(GenerationRetryPolicy.remainingMs(70_000)).toBe(0);
  });

  it("AC-002-04 プロンプト用途が、背景写真を選ぶ・現在の下書きの特徴を保つ・手動で取り込める用途を決める", () => {
    expect(PromptPurpose.all().filter((p) => p.choosesBackgroundPhoto())).toEqual([PromptPurpose.PLAN]);
    expect(PromptPurpose.all().filter((p) => p.keepsCurrentDraftTraits())).toEqual([PromptPurpose.REVISE]);
    expect(PromptPurpose.all().filter((p) => p.acceptsManualImport())).toEqual([PromptPurpose.PLAN, PromptPurpose.REVISE]);
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
