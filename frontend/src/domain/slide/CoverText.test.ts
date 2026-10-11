import { describe, expect, it } from "vitest";
import accentFixture from "../../../../docs/model/fixtures/accent-colors.json";
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

describe("表紙の文言のアクセント色（色の値は AccentColor.test.ts と accent-colors.json）", () => {
  it("AC-006-01 7色すべてのコードを受け付け、黄（YELLOW）は違反。文言の帯の色は区分の値になる", () => {
    for (const c of accentFixture.colors) {
      expect(CoverText.violationsOf(partsOf({ accent: c.code }), sampleSettings())).toEqual([]);
      expect(CoverText.of(partsOf({ accent: c.code }), sampleSettings()).accent).toBe(AccentColor.from(c.code));
    }
    expect(CoverText.violationsOf(partsOf({ accent: "YELLOW" }), sampleSettings()))
      .toEqual(["帯の色は紫・赤・青緑・青・緑・オレンジ・ピンクのどれかにしてください"]);
  });

  it("AC-006-02 帯の色だけを差し替えた新しい文言（ほかの項目は同じ）", () => {
    const text = CoverText.restore(partsOf({}));
    const changed = text.withAccent(AccentColor.BLUE);
    expect(changed.accent).toBe(AccentColor.BLUE);
    expect([changed.target, changed.keyword, changed.annotation, changed.closingWords])
      .toEqual([text.target, text.keyword, text.annotation, text.closingWords]);
    expect(text.accent).toBe(AccentColor.PURPLE);
  });
});
