import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/slide-text.json";
import { sampleSettings, valueOf } from "../__tests__/samples";
import { AccentColor } from "./AccentColor";
import { CoverText } from "./CoverText";

const partsOf = (overrides: Record<string, unknown>) => {
  const merged = { ...fixture.coverBase, ...overrides } as Record<string, string | { repeat: string; count: number }>;
  return { target: valueOf(merged.target), keyword: valueOf(merged.keyword), annotation: valueOf(merged.annotation),
    closingWords: valueOf(merged.closingWords), accentCode: valueOf(merged.accent) };
};

describe("表紙の文言（fixtures/slide-text.json）", () => {
  it.each(fixture.cover)("$id $name", (c) => {
    const parts = partsOf(c.with);
    expect(CoverText.violationsOf(parts, sampleSettings())).toEqual(c.violations);
    if (c.violations.length > 0) {
      expect(() => CoverText.of(parts, sampleSettings())).toThrow(c.violations[0]);
      return;
    }
    expect(CoverText.of(parts, sampleSettings()).keyword).toBe(parts.keyword);
  });

  it("AC-002-22 人がキーワードを13文字に書き換えると保存できず、理由が出る", () => {
    const parts = partsOf({ keyword: "あ".repeat(13) });
    expect(CoverText.violationsOf(parts, sampleSettings())).toEqual(["キーワードは1〜12文字にしてください（13文字）"]);
    expect(() => CoverText.of(parts, sampleSettings())).toThrow("キーワードは1〜12文字");
  });

  it("記録から戻すときは対象の候補を検査しない（設定の候補が後で変わっても過去の版を復元できる）", () => {
    const restored = CoverText.restore(partsOf({ target: "旧候補の対象", keyword: { repeat: "あ", count: 11 } }));
    expect(restored.target).toBe("旧候補の対象");
    expect(restored.keyword).toHaveLength(11);
  });
});

describe("アクセント色（設計 0章の色の値）", () => {
  it("BR-002-12 紫は単色、赤と青緑は左→右のグラデーション", () => {
    expect([AccentColor.PURPLE.startColor, AccentColor.PURPLE.endColor]).toEqual(["#8C52FE", "#8C52FE"]);
    expect([AccentColor.RED.startColor, AccentColor.RED.endColor]).toEqual(["#FD3432", "#FE914C"]);
    expect([AccentColor.TEAL.startColor, AccentColor.TEAL.endColor]).toEqual(["#19BBAA", "#066A85"]);
    expect(AccentColor.PURPLE.cssBackground()).toBe("#8C52FE");
    expect(AccentColor.RED.cssBackground()).toBe("linear-gradient(to right, #FD3432, #FE914C)");
  });

  it("BR-002-12 アクセント色は3つだけ", () => {
    expect(AccentColor.all().map((c) => c.label)).toEqual(["紫", "赤", "青緑"]);
    expect(() => AccentColor.from("GREEN")).toThrow();
  });
});
