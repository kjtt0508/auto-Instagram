import { describe, expect, it } from "vitest";
import { ClosingImageList } from "../post/ClosingImageList";
import { PastPostCover } from "../post/PastPostCover";
import { ClosingContent } from "./ClosingContent";

const images = (...paths: string[]) => ClosingImageList.restore(paths);
const covers = (...paths: string[]) => paths.map((p, i) => PastPostCover.restore(`p${i}`, p));

describe("最後のスライドの中身", () => {
  it("AC-007-05 最後のスライドの画像一覧から作ると、並べる順の参照になる（0・1・2枚）", () => {
    expect(ClosingContent.fromClosingImages(images()).imageRefs()).toEqual([]);
    expect(ClosingContent.fromClosingImages(images("a.jpg")).imageRefs()).toEqual(["a.jpg"]);
    expect(ClosingContent.fromClosingImages(images("a.jpg", "b.jpg")).renderValues())
      .toEqual({ role: "CLOSING", pastPosts: ["a.jpg", "b.jpg"] });
  });

  it("AC-007-09 承認の記録に過去の投稿の表紙があれば、設定の画像ではなく記録の表紙になる", () => {
    const content = ClosingContent.fromApproval(covers("p/1.jpg", "p/2.jpg"), images("a.jpg"));
    expect(content.imageRefs()).toEqual(["p/1.jpg", "p/2.jpg"]);
  });

  it("AC-007-09 記録が0件なら設定の版の画像（REQ-007 より前の設定の版は画像なしなので、画像の欄なしになる）", () => {
    expect(ClosingContent.fromApproval([], images()).imageRefs()).toEqual([]);
    expect(ClosingContent.fromApproval([], images("a.jpg")).imageRefs()).toEqual(["a.jpg"]);
  });

  it("AC-007-10 最後のスライドの画像と過去の投稿の表紙は混ぜない", () => {
    expect(ClosingContent.fromApproval(covers("p/1.jpg"), images("a.jpg", "b.jpg")).imageRefs()).toEqual(["p/1.jpg"]);
  });

  it("AC-007-08 保存に渡す形に並べる画像は持たない（空の中身も同じ）", () => {
    expect(ClosingContent.empty().toStoredForm()).toEqual({ role: "CLOSING" });
    expect(ClosingContent.empty().renderValues()).toEqual({ role: "CLOSING", pastPosts: [] });
  });

  it("BR-007-03 並べる画像の上限は2枚。過去の投稿の表紙が3件の記録は作れない", () => {
    expect(ClosingContent.MAX_IMAGES).toBe(2);
    expect(() => ClosingContent.fromApproval(covers("a", "b", "c"), images())).toThrow("2枚まで");
  });
});
