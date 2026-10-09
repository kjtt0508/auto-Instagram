import { describe, expect, it } from "vitest";
import caption from "../../../../docs/model/fixtures/caption.json";
import { CaptionFooter } from "./CaptionFooter";
import { FailureKind } from "./FailureKind";
import { FixedHashtags } from "./FixedHashtags";
import { PostStyleSettings } from "./PostStyleSettings";

const fixed = FixedHashtags.of(["#同志社大学", "#同志社"]);

describe("固定ハッシュタグ（fixtures/caption.json の hashtagMerges）", () => {
  it.each(caption.hashtagMerges)("$id $name", (c) => {
    expect(FixedHashtags.of(c.fixed).mergedWith(c.additional)).toEqual(c.merged);
  });
});

describe("固定ハッシュタグ", () => {
  it("AC-002-17 追加のハッシュタグと合わせ、固定が先・重複は1つ", () => {
    expect(fixed.mergedWith(["#学割", "#同志社", "#京都"])).toEqual(["#同志社大学", "#同志社", "#学割", "#京都"]);
  });

  it("全角＃と半角#は同じハッシュタグとして重複を除く", () => {
    expect(fixed.mergedWith(["＃同志社"])).toEqual(["#同志社大学", "#同志社"]);
  });

  it("固定の中の重複も除く。ハッシュタグの形でないものは作れない", () => {
    expect(FixedHashtags.of(["#a", "#a"]).texts()).toEqual(["#a"]);
    expect(() => FixedHashtags.of(["同志社"])).toThrow();
  });

  it("AC-002-17 追加のハッシュタグは0〜5個で、ハッシュタグの形", () => {
    expect(fixed.violationsOfAdditional([])).toEqual([]);
    expect(fixed.violationsOfAdditional(["#a", "#b", "#c", "#d", "#e", "#f"])).toEqual(["追加のハッシュタグは5個までです（6個）"]);
    expect(fixed.violationsOfAdditional(["a"])).toEqual(["ハッシュタグの形が正しくありません: a"]);
  });
});

describe("投稿の型の設定", () => {
  const settingsWith = (coverTargets: string[]) => PostStyleSettings.of({
    tenantId: "t1", version: 1, bandText: "帯", coverTargets, closingMessage: "ありがとう", accountIntroduction: "@x",
    captionFooter: CaptionFooter.of("定型"), fixedHashtags: fixed,
  });

  it("BR-002-17 表紙の対象の候補に含まれるかを答える。候補は1件以上", () => {
    expect(settingsWith(["同志社大学"]).acceptsCoverTarget("同志社大学")).toBe(true);
    expect(settingsWith(["同志社大学"]).acceptsCoverTarget("同志社")).toBe(false);
    expect(() => settingsWith([])).toThrow("1件以上");
  });

  it("BR-002-17 キャプションの定型は空にできない", () => {
    expect(() => CaptionFooter.of("  ")).toThrow();
  });
});

describe("失敗区分 RENDER_FAILED", () => {
  it("AC-002-23 画像化の失敗は、やり直せることを案内する", () => {
    expect(FailureKind.from("RENDER_FAILED")).toBe(FailureKind.RENDER_FAILED);
    expect(FailureKind.RENDER_FAILED.label).toBe("画像化の失敗");
    expect(FailureKind.RENDER_FAILED.guidance).toBe("画像化に失敗しました。今すぐ再実行でやり直せます");
    expect(FailureKind.RENDER_FAILED.needsReconnection()).toBe(false);
  });
});
