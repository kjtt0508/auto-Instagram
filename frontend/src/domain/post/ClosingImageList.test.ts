import { describe, expect, it } from "vitest";
import { ClosingContent } from "../slide/ClosingContent";
import { ClosingImage } from "./ClosingImage";
import { ClosingImageList } from "./ClosingImageList";

const image = (name: string) => ClosingImage.restore(`t1/style/${name}.jpg`);
const refs = (...names: string[]) => names.map((n) => `t1/style/${n}.jpg`);

describe("最後のスライドの画像一覧", () => {
  it("AC-007-01 空きがあるあいだは後ろに足せる。2枚あるときは3枚目を足せない", () => {
    const empty = ClosingImageList.empty();
    expect(empty.canAdd()).toBe(true);
    const two = empty.add(image("a")).add(image("b"));
    expect(two.refs()).toEqual(refs("a", "b"));
    expect(two.canAdd()).toBe(false);
    expect(() => two.add(image("c"))).toThrow("2枚まで");
  });

  it("AC-007-04 1枚目を外すと2枚目が1枚目になる（間を空けない）", () => {
    const list = ClosingImageList.restore(refs("a", "b"));
    expect(list.remove(0).refs()).toEqual(refs("b"));
    expect(list.remove(1).refs()).toEqual(refs("a"));
    expect(list.remove(0).remove(0).refs()).toEqual([]);
  });

  it("AC-007-04 選び直すと、その順のまま差し替わる", () => {
    const list = ClosingImageList.restore(refs("a", "b"));
    expect(list.replace(0, image("c")).refs()).toEqual(refs("c", "b"));
    expect(list.replace(1, image("c")).refs()).toEqual(refs("a", "c"));
  });

  it("AC-007-04 操作しても元の一覧は変わらない（値）", () => {
    const list = ClosingImageList.restore(refs("a", "b"));
    list.remove(0);
    list.replace(0, image("c"));
    expect(list.refs()).toEqual(refs("a", "b"));
  });

  it("AC-007-04 外した・選び直したあとは空きができ、足せる", () => {
    expect(ClosingImageList.restore(refs("a", "b")).remove(0).canAdd()).toBe(true);
  });

  it("BR-007-01 同じ保存先は重ねられない", () => {
    expect(() => ClosingImageList.restore(refs("a", "a"))).toThrow("同じ画像を最後のスライドに重ねられません");
    expect(() => ClosingImageList.restore(refs("a", "b")).replace(0, image("b"))).toThrow("同じ画像を最後のスライドに重ねられません");
  });

  it("BR-007-01 存在しない位置は外せない・選び直せない", () => {
    expect(() => ClosingImageList.empty().remove(0)).toThrow("画像はありません");
    expect(() => ClosingImageList.restore(refs("a")).replace(1, image("b"))).toThrow("画像はありません");
  });

  it("BR-007-01 枚数の上限は最後のスライドの中身が持つ（3枚では作れない）", () => {
    expect(ClosingContent.MAX_IMAGES).toBe(2);
    expect(() => ClosingImageList.restore(refs("a", "b", "c"))).toThrow("2枚まで");
  });
});
