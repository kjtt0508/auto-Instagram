import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/slide-text.json";
import { valueOf } from "../__tests__/samples";
import { SlideText } from "./SlideText";

const partsOf = (overrides: Record<string, unknown>) => {
  const merged = { ...fixture.slideBase, ...overrides } as { heading: string | { repeat: string; count: number };
    description: string | { repeat: string; count: number }; emphases: string[] };
  return { heading: valueOf(merged.heading), description: valueOf(merged.description), emphases: merged.emphases };
};

describe("スライドの文言（fixtures/slide-text.json）", () => {
  it.each(fixture.slide)("$id $name", (c) => {
    const parts = partsOf(c.with);
    expect(SlideText.violationsOf(parts)).toEqual(c.violations);
    if (c.violations.length > 0) {
      expect(() => SlideText.of(parts)).toThrow(c.violations[0]);
      return;
    }
    const text = SlideText.of(parts);
    if (c.segments) expect(text.segments()).toEqual(c.segments);
  });

  it("AC-002-12 強調する語の区切りを連結すると説明文に戻る", () => {
    const text = SlideText.of(partsOf({ description: "学割を使って京都を楽しもう", emphases: ["京都", "学割"] }));
    expect(text.segments().map((s) => s.text).join("")).toBe("学割を使って京都を楽しもう");
    expect(text.segments().filter((s) => s.emphasized).map((s) => s.text)).toEqual(["学割", "京都"]);
  });

  it("AC-002-22 人が説明文を121文字に書き換えると保存できず、理由が出る", () => {
    const parts = partsOf({ description: "あ".repeat(121), emphases: [] });
    expect(SlideText.violationsOf(parts)).toEqual(["説明文は1〜120文字にしてください（121文字）"]);
    expect(() => SlideText.of(parts)).toThrow("説明文は1〜120文字");
  });

  it("記録から戻すときは検査しない", () => {
    expect(SlideText.restore(partsOf({ heading: "", emphases: ["無い語"] })).emphases).toEqual(["無い語"]);
  });
});
