import { describe, expect, it } from "vitest";
import { ImageStyle } from "../post/ImageStyle";
import { ImageCandidate } from "./ImageCandidate";
import { ImageGenerationQuota } from "./ImageGenerationQuota";
import { ImageGenerationUsage } from "./ImageGenerationUsage";
import { ImagePrompt } from "./ImagePrompt";

describe("画像生成の指示（BR-005-03, 06）", () => {
  it.each([
    ["0文字", "", false],
    ["1文字", "桜", true],
    ["500文字", "あ".repeat(500), true],
    ["501文字", "あ".repeat(501), false],
  ])("AC-005-02 %s", (_, text, accepted) => {
    const violations = ImagePrompt.violationsOf(text);
    expect(violations.length === 0).toBe(accepted);
    if (!accepted) expect(violations).toEqual(["指示は1〜500文字です"]);
  });

  it.each([
    ["メールアドレス", "taro@example.com のような雰囲気で"],
    ["電話番号", "連絡先 090-1234-5678 の看板"],
    ["電話番号（区切りなし）", "09012345678"],
    ["電話番号（固定）", "075-123-4567"],
  ])("AC-005-03 %sを含む指示は拒否", (_, text) => {
    expect(ImagePrompt.violationsOf(text)).toEqual(["個人を特定できる情報は指示に含められません"]);
  });

  it("日付や年号の数字は個人情報とみなさない", () => {
    expect(ImagePrompt.violationsOf("2026年11月3日の学園祭の雰囲気")).toEqual([]);
  });
});

describe("画像生成の回数と上限（BR-005-07）", () => {
  const quota = ImageGenerationQuota.of(20, 0.8);

  it.each([
    [14, true, false],
    [15, true, false],
    [16, true, true],
    [19, true, true],
    [20, false, true],
  ])("AC-005-06 今日 %i 回生成済み → 生成できる=%s・上限が近い=%s", (used, canGenerate, nearLimit) => {
    const usage = ImageGenerationUsage.of(used, quota);
    expect(usage.canGenerate()).toBe(canGenerate);
    expect(usage.isNearLimit()).toBe(nearLimit);
  });

  it("AC-005-06 14回生成済みで生成すると15回目（警告なし）、15回なら16回目で警告", () => {
    expect(quota.isNearLimit(15)).toBe(false);
    expect(quota.isNearLimit(16)).toBe(true);
  });

  it("残り回数を返す", () => {
    expect(ImageGenerationUsage.of(18, quota).remaining()).toBe(2);
  });
});

describe("画像の種類（BR-005-01 の表）", () => {
  it("AC-005-09 写真風だけ注意書き・承認時の確認・AI生成の表示を出す", () => {
    const traits = (s: ImageStyle) => [s.showsCaution(), s.needsApprovalCheck(), s.requiresAiDisclosure()];
    expect(traits(ImageStyle.PHOTOREALISTIC)).toEqual([true, true, true]);
    expect(traits(ImageStyle.ILLUSTRATION)).toEqual([false, false, false]);
  });

  it("候補は採用されると同じ種類の生成画像になる", () => {
    const generated = ImageCandidate.of({ generationId: "g1", position: 3, style: ImageStyle.PHOTOREALISTIC }).adopted();
    expect([generated.candidatePosition, generated.style, generated.requiresAiDisclosure()]).toEqual([3, ImageStyle.PHOTOREALISTIC, true]);
  });

  it("候補の位置は1〜4", () => {
    expect(() => ImageCandidate.of({ generationId: "g1", position: 5, style: ImageStyle.ILLUSTRATION })).toThrow();
  });
});
