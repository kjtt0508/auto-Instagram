import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/caption.json";
import { Caption } from "./Caption";
import { PrCategory } from "./PrCategory";

const textOf = (segments: { repeat: string; count: number }[]) =>
  segments.map((s) => s.repeat.repeat(s.count)).join("");

describe("キャプションとPR表記（fixtures/caption.json）", () => {
  it.each(fixture.cases)("$id $name", (c) => {
    const text = textOf(c.segments);
    const violations = Caption.violationsOf(text);
    expect(violations.length === 0).toBe(c.valid);
    if (!c.valid) {
      expect(violations).toContain(c.violation);
      return;
    }
    const category = PrCategory.from(c.prCategory);
    const withLabel = category.violationsWithLabel(Caption.of(text), fixture.prLabel);
    expect(withLabel.length === 0).toBe(c.publishValid);
    if (!c.publishValid) expect(withLabel).toContain(c.violation);
  });

  it.each(fixture.cases.filter((c) => c.publishText))("$id 公開用キャプション: $name", (c) => {
    const published = PrCategory.from(c.prCategory).applyLabel(Caption.of(textOf(c.segments)), fixture.prLabel);
    expect(published.text.startsWith(c.publishText!.prefix)).toBe(true);
    expect(published.length()).toBe(c.publishText!.length);
  });

  it("AC-001-09 PR表記を付けると上限を超えるなら、公開用キャプションは作れない", () => {
    const caption = Caption.of("あ".repeat(2196));
    expect(() => PrCategory.PR.applyLabel(caption, fixture.prLabel)).toThrow();
  });

  it("記録から戻すときは上限を検査しない（承認依頼の前に違反として出す）", () => {
    expect(Caption.restore("あ".repeat(2201)).remainingLength()).toBe(-1);
  });

  it("残り文字数を返す", () => {
    expect(Caption.of("あいう").remainingLength()).toBe(2197);
  });
});
