import { describe, expect, it } from "vitest";
import { ClosingContent } from "../slide/ClosingContent";
import { PastPostCover } from "./PastPostCover";

describe("過去の投稿の表紙（REQ-007 より前の承認の記録）", () => {
  it("AC-007-09 記録から戻す（投稿IDと表紙の保存先）", () => {
    const cover = PastPostCover.restore("p2", "t/a.jpg");
    expect([cover.postId, cover.coverStoragePath]).toEqual(["p2", "t/a.jpg"]);
  });

  it("AC-007-09 投稿IDと表紙の保存先は必須", () => {
    expect(() => PastPostCover.restore("", "t/a.jpg")).toThrow("必須");
    expect(() => PastPostCover.restore("p2", " ")).toThrow("必須");
  });

  it("AC-007-09 1つの承認に記録できる件数の上限は、最後のスライドの中身が並べられる枚数（2）", () => {
    expect(ClosingContent.MAX_IMAGES).toBe(2);
  });
});
