import { describe, expect, it } from "vitest";
import { PastPostCover } from "./PastPostCover";

describe("過去の投稿の表紙（最後のスライド）", () => {
  it("AC-002-15 載せる投稿自身の表紙は作れない（選ぶのは承認の出来事で、ここは不変条件だけ）", () => {
    expect(() => PastPostCover.of("p1", "t/a.jpg", "p1")).toThrow("投稿自身");
    expect(PastPostCover.of("p2", "t/a.jpg", "p1").postId).toBe("p2");
  });

  it("AC-002-15 投稿IDと表紙の保存先は必須", () => {
    expect(() => PastPostCover.of("", "t/a.jpg", "p1")).toThrow("必須");
    expect(() => PastPostCover.of("p2", " ", "p1")).toThrow("必須");
  });

  it("AC-002-15 最後のスライドに載せるのは最大2件", () => {
    expect(PastPostCover.MAX_COUNT).toBe(2);
  });
});
