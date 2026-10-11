import { describe, expect, it } from "vitest";
import fixture from "../../../../docs/model/fixtures/accent-colors.json";
import { AccentColor } from "./AccentColor";

/**
 * 白との明るさの比（WCAG のコントラスト比）。テストだけの補助関数で、本番のコードには比の計算を入れない（REQ-006 設計 2章）。
 * TS と Java の二重実装にしない: 比を確かめるのはこのテストだけで、Java 側のテストは AccentColor が同じ accent-colors.json の値を
 * 持つことを確かめる（値が同じなら、ここで確かめた比は Java でも成り立つ）
 */
function contrastWithWhite(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}

describe("アクセント色（fixtures/accent-colors.json。Java の AccentColor と同じ値）", () => {
  it("AC-006-01 BR-006-01 7色が、紫・赤・青緑・青・緑・オレンジ・ピンクの順に並ぶ", () => {
    expect(AccentColor.all().map((c) => c.code)).toEqual(fixture.colors.map((c) => c.code));
    expect(AccentColor.all().map((c) => c.label)).toEqual(["紫", "赤", "青緑", "青", "緑", "オレンジ", "ピンク"]);
    expect(AccentColor.all()).toHaveLength(7);
  });

  it.each(fixture.colors)("AC-006-01 NFR-006-02 $code（$name）のコード・名前・帯の左端と右端の値が共通テストケースと同じ", (c) => {
    const color = AccentColor.from(c.code);
    expect([color.code, color.label, color.startColor, color.endColor]).toEqual([c.code, c.name, c.start, c.end]);
  });

  it.each(fixture.colors)("NFR-006-02 $code の帯の CSS は、単色ならその色、グラデーションなら左→右の2色", (c) => {
    const expected = c.start === c.end ? c.start : `linear-gradient(to right, ${c.start}, ${c.end})`;
    expect(AccentColor.from(c.code).cssBackground()).toBe(expected);
  });

  it("AC-006-03 旧3色（承認済み・公開済みの投稿の色）の値は公開中の投稿から読み取ったまま変わらない", () => {
    expect([AccentColor.PURPLE.startColor, AccentColor.PURPLE.endColor]).toEqual(["#8C52FE", "#8C52FE"]);
    expect([AccentColor.RED.startColor, AccentColor.RED.endColor]).toEqual(["#FD3432", "#FE914C"]);
    expect([AccentColor.TEAL.startColor, AccentColor.TEAL.endColor]).toEqual(["#19BBAA", "#066A85"]);
  });

  it("BR-002-12 紫は単色、ほかはグラデーション", () => {
    expect(AccentColor.PURPLE.cssBackground()).toBe("#8C52FE");
    expect(AccentColor.RED.cssBackground()).toBe("linear-gradient(to right, #FD3432, #FE914C)");
    expect(AccentColor.PINK.cssBackground()).toBe("linear-gradient(to right, #E5528B, #C2185B)");
  });

  it.each(fixture.unknownCodes)("AC-006-01 7色以外のコード「%s」は知らない色として例外", (code) => {
    expect(() => AccentColor.from(code)).toThrow("知らないアクセント色です");
  });

  it("NFR-006-01 新しい4色（青・緑・オレンジ・ピンク）は、帯の左端・右端とも白との明るさの比が 3:1 以上", () => {
    const added = fixture.colors.filter((c) => c.new);
    expect(added.map((c) => c.code)).toEqual(["BLUE", "GREEN", "ORANGE", "PINK"]);
    for (const c of added) {
      const color = AccentColor.from(c.code);
      expect(contrastWithWhite(color.startColor), `${c.code} 左端`).toBeGreaterThanOrEqual(fixture.minContrastRatioForNew);
      expect(contrastWithWhite(color.endColor), `${c.code} 右端`).toBeGreaterThanOrEqual(fixture.minContrastRatioForNew);
    }
  });

  it("NFR-006-01 補助関数の確かめ: 白とのコントラスト比は黒で 21、白で 1", () => {
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 5);
    expect(contrastWithWhite("#FFFFFF")).toBeCloseTo(1, 5);
  });
});
